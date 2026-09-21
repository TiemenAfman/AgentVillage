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
            "/roads status",
        ].join("\n"),
        "show_help"
    );
});

/**
 * /roads
 */
register("roads", ({ args }) => {
    const subcommand = (args[0] ?? "status").toLowerCase();

    switch (subcommand) {
        case "wireframe":
        case "wire":
        case "debug":
            return ok(
                "Road wireframe-weergave ingeschakeld.",
                "roads_wireframe",
                {
                    enabled: true,
                }
            );

        case "connections":
        case "connection":
        case "connect":
            return ok(
                "Huizen zonder verbinding met de Town Square worden gemarkeerd.",
                "roads_connections",
                {
                    enabled: true,
                }
            );

        case "edit":
        case "draw":
        case "build":
            return ok(
                "Road edit-modus ingeschakeld.",
                "roads_edit",
                {
                    enabled: true,
                }
            );

        case "hide":
        case "off":
            return ok(
                "Road debug-weergave uitgeschakeld.",
                "roads_hide",
                {
                    enabled: false,
                }
            );

        case "show":
        case "on":
            return ok(
                "Road debug-weergave ingeschakeld.",
                "roads_show",
                {
                    enabled: true,
                }
            );

        case "status":
        case "info":
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
export function executeCommand(input, context = {}) {
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
        return handler({
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