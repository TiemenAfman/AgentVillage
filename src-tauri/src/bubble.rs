// Chromium's pointer-lock bubble ("localhost:4747 - press Esc to show your cursor"), kept off
// the screen in the desktop window.
//
// WebView2 has no switch for it (WebView2Feedback#3511, open since May 2023) and the page
// cannot prevent it: requestPointerLock() is how walk mode looks around, and every request
// puts the bubble up for ~4.7 s. It is not part of our window. Measured in the debug build
// (spike of 5 October 2026): a separate top-level popup, class Chrome_WidgetWin_1, created by
// the WebView2 *browser* process (msedgewebview2.exe, not ours), WS_POPUP with the extended
// styles TOPMOST | TOOLWINDOW | NOACTIVATE | LAYERED, 525 x 58 pixels at 125 %, centred at the
// top of the page, shown 37 ms after it is created - and, the useful bit, **owned by our
// main window** (GetWindow(GW_OWNER) is the HWND Tauri gave us). A hook installed in our own
// process cannot see windows another process creates, so the way in is SetWinEventHook with
// WINEVENT_OUTOFCONTEXT: the system posts the event to our thread, which hides the window.
//
// What is hidden is decided by `looks_like_bubble` alone - pure, so cargo test holds it - from
// numbers the hook reads off the window. Owned by us AND the browser's popup class AND a
// small strip centred at the top of our window is narrow on purpose: a <select>'s dropdown,
// a tooltip or a context menu (all owned popups of the same class) must keep working.
//
// Hiding alone is not enough, and that is the part the spike found the hard way: Chromium
// shows the bubble again every ~70 ms for as long as it lives (55 SHOW events in one lock), so
// a plain SW_HIDE was a flicker that a 6 ms screen sampler still caught on 365 of 585 samples
// (the control). Moved to -32000,-32000 it stays out of sight wherever Chromium shows it, and
// the sampler caught 0 of 587; the bubble is no longer where `looks_like_bubble` expects it,
// so those later events leave it alone. The hook is asynchronous, so the first paint before
// our move is not ruled out, but no sample of the spike caught one.
// PROMPTHOLM_KEEP_BUBBLE=1 turns the whole thing off (the control of that measurement).
#![cfg(windows)]

use std::sync::atomic::{AtomicIsize, Ordering};

use windows_sys::Win32::Foundation::{HWND, RECT};
use windows_sys::Win32::UI::Accessibility::{SetWinEventHook, UnhookWinEvent, HWINEVENTHOOK};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    DispatchMessageW, GetClassNameW, GetMessageW, GetWindow, GetWindowLongW, GetWindowRect,
    IsWindowVisible, SetWindowPos, ShowWindow, TranslateMessage, SWP_NOACTIVATE, SWP_NOSIZE, SWP_NOZORDER, GWL_EXSTYLE, GWL_STYLE, GW_OWNER, MSG,
    OBJID_WINDOW, SW_HIDE, WS_EX_NOACTIVATE, WS_EX_TOPMOST, WS_POPUP,
};

// EVENT_OBJECT_CREATE .. EVENT_OBJECT_SHOW: the bubble is created hidden and then shown, and
// both are hidden (a window that is hidden at creation is simply shown again by Chromium).
const EVENT_OBJECT_CREATE: u32 = 0x8000;
const EVENT_OBJECT_SHOW: u32 = 0x8002;
const WINEVENT_OUTOFCONTEXT: u32 = 0;
const WINEVENT_SKIPOWNPROCESS: u32 = 2;

/// The window the bubble is owned by. The hook callback is a bare function, so it cannot
/// close over it.
static OWNER: AtomicIsize = AtomicIsize::new(0);

/// A pixel rectangle: left, top, right, bottom.
pub type Rect = (i32, i32, i32, i32);

/// The bubble's shape: a popup of the browser's class, topmost and never activated, a strip
/// rather than a box, centred horizontally and within the top of its owner. The owner check
/// (that the window is ours) is the caller's, since it takes a Win32 call.
pub fn looks_like_bubble(class: &str, style: u32, ex_style: u32, rect: Rect, owner: Rect) -> bool {
    let (l, t, r, b) = rect;
    let (ol, ot, or, ob) = owner;
    let (w, h) = (r - l, b - t);
    let owner_w = or - ol;
    // Sizes are in device pixels and the bubble grows with the display scale (58 high at
    // 125 %), so the limits are generous: more than a button, much less than a menu or a dialog.
    let strip = (150..=1400).contains(&w) && (20..=140).contains(&h) && w * 5 > h * 8;
    let centred = ((l + r) / 2 - (ol + or) / 2).abs() <= owner_w / 12 + 8;
    let at_top = t >= ot - 8 && t <= ot + 400 && b <= ob;
    class == "Chrome_WidgetWin_1"
        && style & WS_POPUP != 0
        && ex_style & WS_EX_TOPMOST != 0
        && ex_style & WS_EX_NOACTIVATE != 0
        && strip
        && centred
        && at_top
}

unsafe extern "system" fn on_event(
    _hook: HWINEVENTHOOK,
    _event: u32,
    hwnd: HWND,
    id_object: i32,
    id_child: i32,
    _thread: u32,
    _time: u32,
) {
    if id_object != OBJID_WINDOW || id_child != 0 || hwnd.is_null() {
        return;
    }
    let owner = OWNER.load(Ordering::Relaxed);
    if owner == 0 || GetWindow(hwnd, GW_OWNER) as isize != owner {
        return;
    }
    let mut name = [0u16; 64];
    let n = GetClassNameW(hwnd, name.as_mut_ptr(), name.len() as i32);
    let class = String::from_utf16_lossy(&name[..n.max(0) as usize]);
    let (mut r, mut o) = (std::mem::zeroed::<RECT>(), std::mem::zeroed::<RECT>());
    if GetWindowRect(hwnd, &mut r) == 0 || GetWindowRect(owner as HWND, &mut o) == 0 {
        return;
    }
    let style = GetWindowLongW(hwnd, GWL_STYLE) as u32;
    let ex = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
    if looks_like_bubble(&class, style, ex, (r.left, r.top, r.right, r.bottom), (o.left, o.top, o.right, o.bottom))
        && IsWindowVisible(hwnd) != 0
    {
        // Off the screen first (see the header), then hidden: a window Chromium puts back is
        // matched and moved again.
        SetWindowPos(hwnd, std::ptr::null_mut(), -32000, -32000, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
        ShowWindow(hwnd, SW_HIDE);
    }
}

/// Start hiding the pointer-lock bubble of the window `owner` (its HWND). One thread for the
/// life of the process: a WinEvent hook is delivered through the message loop of the thread
/// that set it, so that thread does nothing else.
pub fn hide_pointer_lock_bubble(owner: isize) {
    // The way back if the hook ever misbehaves on somebody's machine.
    if std::env::var_os("PROMPTHOLM_KEEP_BUBBLE").is_some() {
        return;
    }
    OWNER.store(owner, Ordering::Relaxed);
    std::thread::spawn(|| unsafe {
        let hook = SetWinEventHook(
            EVENT_OBJECT_CREATE,
            EVENT_OBJECT_SHOW,
            std::ptr::null_mut(),
            Some(on_event),
            0,
            0,
            WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
        );
        if hook.is_null() {
            return;
        }
        let mut msg: MSG = std::mem::zeroed();
        while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
        UnhookWinEvent(hook);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    // The measured bubble on a 2560-wide window at 125 %: 525 x 58, at the top, in the middle.
    const OWNER: Rect = (912, 180, 2528, 1219);
    const BUBBLE: Rect = (1457, 255, 1982, 313);
    const STYLE: u32 = 0x9600_0000;
    const EX: u32 = 0x0820_00A8;

    #[test]
    fn the_measured_bubble_is_one() {
        assert!(looks_like_bubble("Chrome_WidgetWin_1", STYLE, EX, BUBBLE, OWNER));
    }

    #[test]
    fn other_windows_of_the_browser_are_left_alone() {
        // A select's dropdown: small, not at the middle top.
        assert!(!looks_like_bubble("Chrome_WidgetWin_1", STYLE, EX, (1900, 700, 2050, 760), OWNER));
        // A context menu or a dialog: tall.
        assert!(!looks_like_bubble("Chrome_WidgetWin_1", STYLE, EX, (1300, 255, 1700, 700), OWNER));
        // The render surface and the like are another class.
        assert!(!looks_like_bubble("Chrome_RenderWidgetHostHWND", STYLE, EX, BUBBLE, OWNER));
        // Not topmost / not a no-activate popup: a normal window.
        assert!(!looks_like_bubble("Chrome_WidgetWin_1", STYLE, 0, BUBBLE, OWNER));
        assert!(!looks_like_bubble("Chrome_WidgetWin_1", 0x0100_0000, EX, BUBBLE, OWNER));
    }

    #[test]
    fn it_follows_the_window_not_the_screen() {
        // The same bubble in a window that sits elsewhere is still one; one far off to the
        // side of its window is not.
        let moved: Rect = (100, 50, 1716, 1089);
        let bubble: Rect = (645, 125, 1170, 183);
        assert!(looks_like_bubble("Chrome_WidgetWin_1", STYLE, EX, bubble, moved));
        assert!(!looks_like_bubble("Chrome_WidgetWin_1", STYLE, EX, (120, 125, 645, 183), moved));
    }
}
