// lib/commands.mjs

/**
 * Game command handling.
 *
 * Commands are entered through the chat input, but are NOT treated
 * as normal chat messages.
 *
 * Supported commands:
 *
 *   /help
 *   /roads
 *   /roads wireframe
 *   /roads connections
 *   /roads edit
 *   /roads hide
 *   /roads show
 *   /roads redraw
 *   /roads reroute
 *   /roads delete
 *   /roads status
 *
 * The returned result is intended for the client.
 * Three.js-specific work stays in the browser.
 */

const COMMANDS = new Map();

/**
 * Register a command.
 */
function register(name, handler) {
    COMMANDS.set(name.toLowerCase(), handler);
}

/**
 * Normalize command input.
 */
function normalizeInput(input) {
    if (typeof input !== "string") {
        return "";
    }

    return input.trim();
}

/**
 * Split a command line while preserving quoted arguments.
 *
 * Example:
 *   /roads wireframe
 *
 * becomes:
 *   ["roads", "wireframe"]
 */
function tokenize(input) {
    const result = [];
    const regex = /"([^"]*)"|'([^']*)'|(\S+)/g;

    let match;

    while ((match = regex.exec(input)) !== null) {
        result.push(match[1] ?? match[2] ?? match[3]);
    }

    return result;
}

/**
 * Create a successful command result.
 */
function ok(message, action = null, data = null) {
    return {
        ok: true,
        message,
        action,
        data,
    };
}

/**
 * Create a failed command result.
 */
function error(message) {
    return {
        ok: false,
        message,
        action: null,
        data: null,
    };
}

/**
 * /help
 */
register("help", ({ args }) => {
    if (args.length > 0) {
        return error(`Geen help beschikbaar voor "/${args[0]}".`);
    }

    return ok(
        [
            "Beschikbare commands:",
            "/help",
            "/roads",
            "/roads wireframe",
            "/roads connections",
            "/roads edit",
            "/roads hide",
            "/roads show",
            "/roads redraw",
            "/roads reroute",
            "/roads delete",
            "/roads status",
        ].join("\n"),
        "show_help"
    );
});

/**
 * /roads
 */
register("roads", async ({ args, context }) => {
    const subcommand = (args[0] ?? "status").toLowerCase();

    switch (subcommand) {
        case "wireframe":
            // The server has no idea whether the client's wireframe is currently on -
            // that state lives in road-debug.js, not here - so this asks for a toggle
            // rather than asserting a value it cannot see.
            return ok(
                "Road wireframe-weergave omgeschakeld.",
                "roads_wireframe_toggle"
            );

        case "connections":
            // Same reasoning as wireframe: the client owns whether the markers are
            // currently showing, so this asks for a toggle rather than asserting a value
            // the server cannot see.
            return ok(
                "Huizen zonder verbinding met de Town Square worden gemarkeerd of niet meer.",
                "roads_connections_toggle"
            );

        case "edit":
            return ok(
                "Road edit-modus ingeschakeld.",
                "roads_edit",
                {
                    enabled: true,
                }
            );

        case "hide":
            return ok(
                "Road debug-weergave uitgeschakeld.",
                "roads_hide",
                {
                    enabled: false,
                }
            );

        case "show":
            return ok(
                "Road debug-weergave ingeschakeld.",
                "roads_show",
                {
                    enabled: true,
                }
            );

        case "redraw":
            // A rescan plans a path for any plot placed since the last one (see
            // "front paths" in lib/layout.mjs) - that is how a new house gets a way out
            // without re-routing a road already on record. Waiting for it here (not
            // firing it and returning) is what lets the message promise "opnieuw
            // doorgerekend" rather than "opnieuw gevraagd".
            if (typeof context.rescan === "function") {
                await context.rescan();
            }
            return ok(
                "Wegen opnieuw doorgerekend; de debug-weergave wordt herbouwd.",
                "roads_redraw"
            );

        case "reroute":
            // Unlike redraw, this throws every road and path away first (clearRoads in
            // lib/layout.mjs) instead of only filling in what a new house is missing - a
            // forced clean re-route, not a fill-up. And unlike delete below, it never
            // leaves a house disconnected: the same rescan that clears the roads replans
            // them in one pass, so this is not a route back to exactly what was there
            // (routing reuses whatever is already laid, and a clean grid reuses
            // differently), but it is never a route to nothing either.
            if (typeof context.rescan === "function") {
                await context.rescan({ clearRoads: true });
            }
            return ok(
                "Wegen en paden gewist en van scratch opnieuw aangelegd.",
                "roads_redraw"
            );

        case "delete":
            // A real deletion: writes layout.json and village.json with every road and
            // path gone, and runs no placeAll pass to heal it - see deleteRoads() in
            // scan.mjs. Every house this leaves disconnected shows its marker the moment
            // /roads connections is on, which is the whole reason this command exists
            // beside reroute: reroute can never produce that state, because placeAll
            // never lets it. Lasts until the next scan, whichever asks for one first.
            if (typeof context.deleteRoads === "function") {
                await context.deleteRoads();
            }
            return ok(
                "Wegen en paden verwijderd. Blijft zo tot de volgende scan.",
                "roads_delete"
            );

        case "status":
            return ok(
                "Road-status opgevraagd.",
                "roads_status"
            );

        case "":
            return ok(
                [
                    "Road commands:",
                    "/roads wireframe",
                    "/roads connections",
                    "/roads edit",
                    "/roads hide",
                    "/roads show",
                    "/roads redraw",
                    "/roads reroute",
                    "/roads delete",
                    "/roads status",
                ].join("\n"),
                "roads_help"
            );

        default:
            return error(
                `Onbekend roads-command: "${subcommand}". Gebruik /roads voor een overzicht.`
            );
    }
});

/**
 * Execute a command.
 *
 * Returns:
 *
 * {
 *   ok: true/false,
 *   message: "...",
 *   action: "...",
 *   data: ...
 * }
 */
export async function executeCommand(input, context = {}) {
    const normalized = normalizeInput(input);

    if (!normalized) {
        return error("Leeg command.");
    }

    if (!normalized.startsWith("/")) {
        return error("Dit is geen command.");
    }

    const tokens = tokenize(normalized.slice(1));

    if (tokens.length === 0) {
        return error("Leeg command. Gebruik /help.");
    }

    const name = tokens.shift().toLowerCase();
    const handler = COMMANDS.get(name);

    if (!handler) {
        return error(
            `Onbekend command: "/${name}". Gebruik /help voor een overzicht.`
        );
    }

    try {
        return await handler({
            args: tokens,
            input: normalized,
            context,
        });
    } catch (err) {
        console.error(`[command] /${name} failed:`, err);

        return error(
            `Command "/${name}" kon niet worden uitgevoerd.`
        );
    }
}

/**
 * Check whether a string is a command.
 */
export function isCommand(input) {
    return (
        typeof input === "string" &&
        input.trim().startsWith("/")
    );
}

/**
 * Return the list of registered commands.
 */
export function listCommands() {
    return [...COMMANDS.keys()];
}