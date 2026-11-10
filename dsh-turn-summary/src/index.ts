/**
 * Fixed per-Turn summary plugin, node half. Pure UI plugin: the empty apply
 * exists so the plugin appears in the host cordis.yml / Loader; the browser
 * half ships via exports["./client"], discovered through the package.json
 * dsh.client declaration. The line is folded entirely in the browser from
 * Session events the Client already received, so nothing reaches the model,
 * the prompt, or the Session log.
 */

/** Host plugin body — no host-side behavior for this presentation plugin. */
export function apply(): void {}
