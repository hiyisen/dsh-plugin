/**
 * Zero-dependency test harness for dsh-turn-summary.
 *
 * It loads the very artifact this repository publishes (`lib/client.js`) with a
 * fake browser module loader, a minimal React stand-in, a fake DOM, and a fake
 * client context, so every assertion runs against shipped bytes instead of a
 * re-implementation of the fold.
 *
 * No npm dependency, no network, no build step. Run it from the repository root:
 *
 *   node --test "dsh-turn-summary/tests/*.test.mjs"
 *
 * Do NOT pass the directory: Node >= 22 treats a positional argument to
 * `--test` as a glob pattern and no longer walks directories, so
 * `node --test dsh-turn-summary/tests/` fails with "Cannot find module".
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Absolute path of the plugin package root. */
export const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Absolute path of the published browser artifact under test. */
export const CLIENT_ARTIFACT = join(PACKAGE_ROOT, 'lib', 'client.js')

/** The published browser artifact's source text, exactly as it ships. */
export const CLIENT_ARTIFACT_SOURCE = readFileSync(CLIENT_ARTIFACT, 'utf8')

/** The hashed CSS-module class the shipped artifact assigns to the summary row. */
export const CSS_ROOT_CLASS = 'vqEcJa_root'

/** The `data-plugin` value the shipped artifact stamps on its <style> node. */
export const PLUGIN_ID = 'dsh-turn-summary'

/**
 * Minimal React stand-in: `jsx`/`jsxs` produce assertable vnodes without any
 * real rendering.
 * @returns {object} the fake `react/jsx-runtime` module.
 */
export function createReactStub() {
  const createElement = (type, props = {}) => ({ type, props: { ...props } })
  return { Fragment: 'Fragment', jsx: createElement, jsxs: createElement }
}

/**
 * Fake document that records the injected `<style>` nodes.
 * @returns {object} the fake document.
 */
export function createDocumentStub() {
  const styles = []
  return {
    styles,
    head: {
      appendChild(node) {
        styles.push(node)
        return node
      },
    },
    querySelector() {
      return null
    },
    createElement(tag) {
      return { tagName: tag, dataset: {}, textContent: '' }
    },
  }
}

/**
 * Fake client context recording every registration the plugin performs.
 * @returns {object} the fake context plus every recording.
 */
export function createContextStub() {
  const localeRegistrations = []
  const definitionRegistrations = []
  const slotInjections = []
  const slotRegistrations = []
  const effects = []
  const ctx = {
    effect(fn, label) {
      effects.push({ label })
      fn()
      return () => {}
    },
    locale: {
      register(namespace, dictionary) {
        localeRegistrations.push({ namespace, dictionary })
      },
    },
    uiConversation: {
      events: {
        register(definition) {
          definitionRegistrations.push(definition)
        },
      },
    },
    slots: {
      inject(name, factory) {
        slotInjections.push({ name, factory })
        return factory()
      },
      register(row, component) {
        slotRegistrations.push({ row, component })
        return row
      },
    },
  }
  return {
    ctx,
    localeRegistrations,
    definitionRegistrations,
    slotInjections,
    slotRegistrations,
    effects,
  }
}

/**
 * Load the published artifact, run its `apply` against a fake context, and
 * hand every recording back to the test.
 *
 * The optional `source` lets a test evaluate a *copy* of the shipped bytes
 * with one seam swapped (for example a different tool-owner resolver). The
 * file on disk is never written to; only the text handed to this function
 * changes.
 * @param {string} [source] - artifact source to evaluate; defaults to the published file.
 * @returns {object} artifact, exports, context and DOM recordings.
 */
export function loadArtifact(source = CLIENT_ARTIFACT_SOURCE) {
  const registrations = []
  const requested = []
  const react = createReactStub()
  const document = createDocumentStub()
  const window = {
    __ModuleLoader__: {
      load(registration) {
        registrations.push(registration)
        return registration
      },
    },
  }
  const requireStub = (name) => {
    requested.push(name)
    if (name === 'react/jsx-runtime') return react
    throw new Error(`unexpected require(): ${name}`)
  }
  // Evaluate inside this realm so object prototypes match `assert.deepStrictEqual`.
  const run = new Function('window', 'document', source)
  run(window, document)
  const registration = registrations[0]
  const exports = registration.factory(requireStub)
  const context = createContextStub()
  exports.apply(context.ctx)
  return { registration, exports, context, requested, document, registrations }
}

/**
 * Build a real Session event as the Conversation engine hands it to a Definition.
 * @param {string} type - event type.
 * @param {number} seq - event sequence number.
 * @param {object} data - event payload.
 * @returns {object} the event.
 */
export function event(type, seq, data) {
  return { type, seq, data }
}

/**
 * Build a `turn/start` event.
 * @param {number} turn - turn number.
 * @param {number} seq - event sequence number.
 * @returns {object} the event.
 */
export function turnStart(turn, seq) {
  return event('turn/start', seq, { turn })
}

/**
 * Build a `turn/end` event.
 * @param {number} turn - turn number.
 * @param {number} seq - event sequence number.
 * @returns {object} the event.
 */
export function turnEnd(turn, seq) {
  return event('turn/end', seq, { turn })
}

/**
 * Build a `tool/call` event.
 * @param {number} turn - turn number.
 * @param {number} seq - event sequence number.
 * @param {string} name - wire tool name.
 * @param {string} args - the recorded `arguments` string.
 * @returns {object} the event.
 */
export function toolCall(turn, seq, name, args = '') {
  return event('tool/call', seq, { turn, name, arguments: args })
}

/**
 * Build an event the fold does not consume.
 * @param {number} seq - event sequence number.
 * @returns {object} the event.
 */
export function unrelated(seq) {
  return event('message/part', seq, {})
}

/**
 * Fold an ordered event list through the registered Conversation Definition.
 * @param {object} definition - the registered definition.
 * @param {object[]} events - events in ascending sequence order.
 * @returns {object|undefined} the folded Turn state.
 */
export function foldEvents(definition, events) {
  let state
  for (const current of events) {
    const matcher = definition.match[current.type]
    if (!matcher) continue
    const match = matcher(current)
    if (match.role === 'start') state = definition.start({}, { event: current })
    else state = definition.update({ state }, { event: current })
  }
  return state
}

/**
 * Ask the Definition for the Turn Location data it publishes.
 * @param {object} definition - the registered definition.
 * @param {object} state - the folded Turn state.
 * @param {object} [previous] - the previously published value.
 * @returns {object|null} the Location data.
 */
export function publish(definition, state, previous = undefined) {
  return definition.buildLocationData({ state }, 'turn', previous)
}

/**
 * Build a fake Turn carrying the published summary.
 * @param {number} turn - turn number.
 * @param {object} [summary] - the published summary value.
 * @returns {object} the fake Turn.
 */
export function createTurn(turn, summary = undefined) {
  const data = new Map()
  if (summary !== undefined) data.set('turn-summary', summary)
  return { turn, data: { get: (key) => data.get(key) } }
}

/**
 * Build a translator over one plugin dictionary, mirroring the locale seat.
 * @param {object} dictionary - one language dictionary.
 * @returns {Function} the `t` function.
 */
export function createTranslator(dictionary) {
  return (key, params) => {
    const template = dictionary[key]
    if (template === undefined) throw new Error(`missing dictionary key: ${key}`)
    return template.replace(/\{(\w+)\}/g, (whole, name) => (
      params && Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole
    ))
  }
}

/**
 * Render a vnode into an inspectable HTML-ish string.
 * @param {object} vnode - the vnode produced by the React stand-in.
 * @returns {string} the rendered markup.
 */
export function toHtml(vnode) {
  const attributes = Object.entries(vnode.props)
    .filter(([key]) => key !== 'children')
    .map(([key, value]) => ` ${key === 'className' ? 'class' : key}="${value}"`)
    .join('')
  return `<${vnode.type}${attributes}>${vnode.props.children ?? ''}</${vnode.type}>`
}
