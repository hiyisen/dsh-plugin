window.__ModuleLoader__.load({
	id: "dsh-turn-summary",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region \0dsh-css:src/client/TurnSummaryLine.module.css.mjs
		const css = ".vqEcJa_root{box-sizing:border-box;width:100%;min-width:0;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:var(--dsh-content-font-size,14px);line-height:calc(20px + var(--dsh-content-font-delta,0px));text-overflow:ellipsis;white-space:nowrap;padding:0 0 4px;overflow:hidden}";
		const tagId = "dsh-turn-summary/TurnSummaryLine.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-turn-summary";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var TurnSummaryLine_module_css_default = { "root": "vqEcJa_root" };
		//#endregion
		//#region src/client/TurnSummaryLine.tsx
		/** Facts of a Turn that has published no summary yet. */
		const EMPTY_SUMMARY = {
			turn: 0,
			skillCallCount: 0,
			skillNames: [],
			unreadableSkillCalls: 0,
			pluginNames: [],
			toolCounts: []
		};
		/**
		* Compose the visible line from folded facts and the active dictionary.
		* @param summary - published Turn facts, or undefined before the first publication.
		* @param t - turn-summary dictionary translator.
		* @returns the complete one-line text, explicitly naming empty categories.
		*/
		function summaryText(summary, t) {
			const value = summary ?? EMPTY_SUMMARY;
			const separator = t("separator");
			const skillNames = [...value.skillNames];
			if (value.unreadableSkillCalls > 0) skillNames.push(t("unreadable"));
			const skill = value.skillCallCount === 0 ? t("none") : skillNames.length > 0 ? skillNames.join(separator) : t("unreadable");
			const tools = value.toolCounts.length === 0 ? t("none") : value.toolCounts.map((tool) => t("toolCount", {
				name: tool.name,
				count: tool.count
			})).join(separator);
			if (value.pluginNames.length === 0) return t("line", {
				skill,
				tools
			});
			return t("line.withPlugins", {
				skill,
				plugins: value.pluginNames.join(separator),
				tools
			});
		}
		/**
		* Render one always-visible line per completed Turn. The Turn tail is a list
		* seat outside the Turn's process disclosure, so the line stays visible while
		* the Tool group is collapsed; it has no open state, button, or command.
		* @param props - enclosing Turn and the active dictionary.
		* @returns the fixed summary row.
		*/
		function TurnSummaryLine({ turn, t }) {
			const summary = turn.data.get("turn-summary");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: TurnSummaryLine_module_css_default.root,
				"data-turn-summary": turn.turn,
				"data-turn-summary-skill-calls": summary?.skillCallCount ?? 0,
				"data-turn-summary-tool-calls": summary?.toolCounts.reduce((total, tool) => total + tool.count, 0) ?? 0,
				children: summaryText(summary, t)
			});
		}
		//#endregion
		//#region src/client/locales.ts
		/** `turnSummary` namespace dictionaries for the fixed per-Turn line. */
		/** Dictionary namespace owned by this plugin. */
		const NS = "turnSummary";
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"line": "本轮 · skill: {skill} ｜ 工具: {tools}",
			"line.withPlugins": "本轮 · skill: {skill} ｜ 插件: {plugins} ｜ 工具: {tools}",
			"none": "无",
			"unreadable": "未知",
			"separator": ", ",
			"toolCount": "{name}×{count}"
		};
		/** English dictionary, checked complete against the zh key set. */
		const en = {
			"line": "This turn · skill: {skill} | tools: {tools}",
			"line.withPlugins": "This turn · skill: {skill} | plugins: {plugins} | tools: {tools}",
			"none": "None",
			"unreadable": "unknown",
			"separator": ", ",
			"toolCount": "{name}×{count}"
		};
		/** Japanese dictionary, checked against the English keys. */
		const ja = {
			"line": "本ラウンド · skill: {skill} ｜ ツール: {tools}",
			"line.withPlugins": "本ラウンド · skill: {skill} ｜ プラグイン: {plugins} ｜ ツール: {tools}",
			"none": "なし",
			"unreadable": "不明",
			"separator": ", ",
			"toolCount": "{name}×{count}"
		};
		/** Spanish dictionary, checked against the English keys. */
		const es = {
			"line": "Esta ronda · skill: {skill} ｜ herramientas: {tools}",
			"line.withPlugins": "Esta ronda · skill: {skill} ｜ complementos: {plugins} ｜ herramientas: {tools}",
			"none": "Ninguno",
			"unreadable": "desconocido",
			"separator": ", ",
			"toolCount": "{name}×{count}"
		};
		/** French dictionary, checked against the English keys. */
		const fr = {
			"line": "Ce tour · skill: {skill} ｜ outils: {tools}",
			"line.withPlugins": "Ce tour · skill: {skill} ｜ plugins: {plugins} ｜ outils: {tools}",
			"none": "Aucun",
			"unreadable": "inconnu",
			"separator": ", ",
			"toolCount": "{name}×{count}"
		};
		/** German dictionary, checked against the English keys. */
		const de = {
			"line": "Dieser Durchlauf · skill: {skill} ｜ Werkzeuge: {tools}",
			"line.withPlugins": "Dieser Durchlauf · skill: {skill} ｜ Plugins: {plugins} ｜ Werkzeuge: {tools}",
			"none": "Keine",
			"unreadable": "unbekannt",
			"separator": ", ",
			"toolCount": "{name}×{count}"
		};
		/** Russian dictionary, checked against the English keys. */
		const ru = {
			"line": "Этот раунд · skill: {skill} ｜ инструменты: {tools}",
			"line.withPlugins": "Этот раунд · skill: {skill} ｜ плагины: {plugins} ｜ инструменты: {tools}",
			"none": "Нет",
			"unreadable": "неизвестно",
			"separator": ", ",
			"toolCount": "{name}×{count}"
		};
		/** Portuguese dictionary, checked against the English keys. */
		const pt = {
			"line": "Esta rodada · skill: {skill} ｜ ferramentas: {tools}",
			"line.withPlugins": "Esta rodada · skill: {skill} ｜ plugins: {plugins} ｜ ferramentas: {tools}",
			"none": "Nenhum",
			"unreadable": "desconhecido",
			"separator": ", ",
			"toolCount": "{name}×{count}"
		};
		/** Conversation Location data key this plugin publishes for one Turn. */
		const TURN_SUMMARY_DATA_KEY = "turn-summary";
		/** Conversation Definition kind that folds one Turn's calls. */
		const TURN_SUMMARY_DEFINITION_KIND = "turn-summary";
		/** Identity of the `conversation.chat.turnTail` list entry owned by this plugin. */
		const TURN_TAIL_ROW_KEY = "dsh-turn-summary";
		/**
		* Step-one owner resolver: the Client has no tool-to-plugin map, so every
		* lookup honestly reports an unknown owner instead of inventing one.
		*/
		const NO_TOOL_OWNERS = { ownersOf: () => [] };
		/**
		* Trim and bound one wire or user-supplied name.
		* @param value - raw name.
		* @returns a bounded name, empty when the raw name carries no visible text.
		*/
		function boundedName(value) {
			return Array.from(value.trim()).slice(0, 120).join("");
		}
		/**
		* Read a skill name from a `skill` tool call's JSON arguments.
		* @param argumentsText - the `arguments` string recorded on `tool/call`.
		* @returns the bounded skill name, or undefined when the call names none.
		*/
		function skillNameOf(argumentsText) {
			if (argumentsText.length > 4096) return void 0;
			let parsed;
			try {
				parsed = JSON.parse(argumentsText);
			} catch {
				return;
			}
			if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return void 0;
			if (!("name" in parsed)) return void 0;
			const name = parsed.name;
			if (typeof name !== "string") return void 0;
			const bounded = boundedName(name);
			return bounded === "" ? void 0 : bounded;
		}
		/**
		* Create the empty state of one Turn.
		* @param turn - Turn number.
		* @param startSeq - sequence of this Turn's `turn/start`.
		* @returns state with no skills and no tool calls.
		*/
		function emptyTurnSummaryState(turn, startSeq) {
			return {
				turn,
				startSeq,
				skillCallCount: 0,
				skillNames: [],
				unreadableSkillCalls: 0,
				toolCounts: []
			};
		}
		/**
		* Increment one tool's counter, preserving first-use order.
		* @param counts - counters so far.
		* @param name - bounded tool name.
		* @returns a new counter list.
		*/
		function bumpTool(counts, name) {
			let found = false;
			const next = counts.map((entry) => {
				if (entry.name !== name) return entry;
				found = true;
				return {
					name,
					count: entry.count + 1
				};
			});
			return found ? next : [...counts, {
				name,
				count: 1
			}];
		}
		/**
		* Fold one adapted event into a Turn's state. A `turn/start` resets the state,
		* so a fork's inherited history cannot contribute to the new Turn; events from
		* another Turn or before this Turn's start are ignored for the same reason.
		* @param state - current Turn state.
		* @param event - adapted event.
		* @returns the next Turn state.
		*/
		function foldTurnSummaryEvent(state, event) {
			if (event.type === "turn/start") return emptyTurnSummaryState(event.turn, event.seq);
			if (event.type === "ignored" || event.type === "turn/end") return state;
			if (event.turn !== state.turn || event.seq < state.startSeq) return state;
			const name = boundedName(event.name);
			if (name === "") return state;
			if (name === "skill") {
				const skillName = skillNameOf(event.arguments);
				if (skillName === void 0) return {
					...state,
					skillCallCount: state.skillCallCount + 1,
					unreadableSkillCalls: state.unreadableSkillCalls + 1
				};
				const added = !state.skillNames.includes(skillName) && state.skillNames.length < 16;
				return {
					...state,
					skillCallCount: state.skillCallCount + 1,
					...added ? { skillNames: [...state.skillNames, skillName] } : {}
				};
			}
			return {
				...state,
				toolCounts: bumpTool(state.toolCounts, name)
			};
		}
		/**
		* Collect the distinct plugin names attributed to this Turn's tools.
		* @param state - folded Turn state.
		* @param owners - attribution resolver.
		* @returns plugin names in first-attribution order.
		*/
		function pluginNamesOf(state, owners) {
			const names = [];
			for (const tool of state.toolCounts) for (const candidate of owners.ownersOf(tool.name)) {
				const name = boundedName(candidate);
				if (name !== "" && !names.includes(name)) names.push(name);
			}
			return names;
		}
		/**
		* Publish a Turn's folded facts as an immutable Location value.
		* @param state - folded Turn state.
		* @param owners - attribution resolver; unknown owners by default.
		* @returns the value the Turn-tail row renders.
		*/
		function toTurnSummary(state, owners = NO_TOOL_OWNERS) {
			return {
				turn: state.turn,
				skillCallCount: state.skillCallCount,
				skillNames: state.skillNames,
				unreadableSkillCalls: state.unreadableSkillCalls,
				pluginNames: pluginNamesOf(state, owners),
				toolCounts: state.toolCounts
			};
		}
		/**
		* Compare two published summaries field by field so an unchanged materialization
		* keeps its predecessor's identity.
		* @param left - previous value.
		* @param right - current value.
		* @returns whether both describe the same Turn facts.
		*/
		function sameTurnSummary(left, right) {
			return left.turn === right.turn && left.skillCallCount === right.skillCallCount && left.unreadableSkillCalls === right.unreadableSkillCalls && sameStrings(left.skillNames, right.skillNames) && sameStrings(left.pluginNames, right.pluginNames) && left.toolCounts.length === right.toolCounts.length && left.toolCounts.every((tool, index) => tool.name === right.toolCounts[index]?.name && tool.count === right.toolCounts[index]?.count);
		}
		/**
		* Compare two ordered name lists.
		* @param left - previous list.
		* @param right - current list.
		* @returns whether both lists hold the same names in the same order.
		*/
		function sameStrings(left, right) {
			return left.length === right.length && left.every((name, index) => name === right[index]);
		}
		//#endregion
		//#region src/client/turn-summary-definition.ts
		/**
		* Narrow one real Session event to the facts this fold consumes.
		* @param event - durable or transient Client event.
		* @returns the adapted event; unrelated events become `ignored`.
		*/
		function toTurnSummaryEvent(event) {
			switch (event.type) {
				case "turn/start": return {
					type: "turn/start",
					seq: event.seq,
					turn: event.data.turn
				};
				case "turn/end": return {
					type: "turn/end",
					seq: event.seq,
					turn: event.data.turn
				};
				case "tool/call": return {
					type: "tool/call",
					seq: event.seq,
					turn: event.data.turn,
					name: event.data.name,
					arguments: event.data.arguments
				};
				default: return {
					type: "ignored",
					seq: event.seq
				};
			}
		}
		/**
		* Build the Definition for one attribution resolver.
		* @param owners - tool-to-plugin attribution; unknown owners in step one.
		* @returns a state-only Conversation Definition publishing one Turn's summary.
		*/
		function createTurnSummaryDefinition(owners) {
			return {
				kind: TURN_SUMMARY_DEFINITION_KIND,
				match: (event) => {
					if (event.type === "turn/start") return {
						id: String(event.data.turn),
						role: "start"
					};
					if (event.type === "tool/call" || event.type === "turn/end") return {
						id: String(event.data.turn),
						role: "update"
					};
					return null;
				},
				start: (_context, match) => {
					const event = toTurnSummaryEvent(match.event);
					/* v8 ignore next 2 -- the engine calls start only for the turn/start match this Definition returns. */
					if (event.type !== "turn/start") throw new Error("turn-summary start requires turn/start");
					return emptyTurnSummaryState(event.turn, event.seq);
				},
				update: (context, match) => foldTurnSummaryEvent(context.state, toTurnSummaryEvent(match.event)),
				buildLocationData: (context, scope, previous) => {
					if (scope !== "turn" || context.state === void 0) return null;
					const value = toTurnSummary(context.state, owners);
					if (previous?.kind === "turn" && previous.key === "turn-summary" && previous.turn === value.turn && sameTurnSummary(previous.value, value)) return previous;
					return {
						kind: "turn",
						turn: value.turn,
						key: TURN_SUMMARY_DATA_KEY,
						value
					};
				}
			};
		}
		//#endregion
		//#region src/client/index.ts
		/** Required services: dictionaries, the Conversation Definition registry, and slots. */
		const inject = [
			"slots",
			"locale",
			"uiConversation"
		];
		/**
		* Register the dictionaries, the Turn-scoped Definition, and the fixed line.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en,
				ja,
				es,
				fr,
				de,
				ru,
				pt
			}), "ui-turn-summary: dictionaries");
			const definition = createTurnSummaryDefinition(NO_TOOL_OWNERS);
			const match = definition.match.bind(definition);
			ctx.effect(() => ctx.uiConversation.events.register({
				...definition,
				match: {
					"turn/start": match,
					"tool/call": match,
					"turn/end": match
				}
			}), "ui-turn-summary: conversation definition");
			ctx.slots.inject("conversation.chat.turnTail", () => ctx.slots.register({
				name: "conversation.chat.turnTail",
				id: TURN_TAIL_ROW_KEY,
				order: 10,
				locale: NS
			}, TurnSummaryLine));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map