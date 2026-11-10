/**
 * Behaviour of the shipped artifact: the fold, the Conversation Definition,
 * and the rendered line. Every case states the expected value, never just
 * "something exists".
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  CLIENT_ARTIFACT_SOURCE,
  CSS_ROOT_CLASS,
  createTurn,
  createTranslator,
  foldEvents,
  loadArtifact,
  publish,
  toHtml,
  toolCall,
  turnEnd,
  turnStart,
  unrelated,
} from './harness.mjs'

const artifact = loadArtifact()
const definition = artifact.context.definitionRegistrations[0]
const component = artifact.context.slotRegistrations[0].component
const zh = artifact.context.localeRegistrations[0].dictionary.zh
const t = createTranslator(zh)

/** Golden sequence of one turn, as measured from the shipped artifact. */
const GOLDEN_EVENTS = [
  turnStart(7, 100),
  toolCall(7, 101, 'skill', JSON.stringify({ name: 'dsh-client-ui-ux' })),
  toolCall(7, 102, 'read', '{}'),
  toolCall(7, 103, 'read', '{}'),
  toolCall(7, 104, 'grep', '{}'),
]

test('黄金输出：折叠后的状态', () => {
  const state = foldEvents(definition, GOLDEN_EVENTS)
  assert.deepEqual(state, {
    turn: 7,
    startSeq: 100,
    skillCallCount: 1,
    skillNames: ['dsh-client-ui-ux'],
    unreadableSkillCalls: 0,
    toolCounts: [
      { name: 'read', count: 2 },
      { name: 'grep', count: 1 },
    ],
  })
})

test('黄金输出：发布的 Turn Location 数据', () => {
  const state = foldEvents(definition, GOLDEN_EVENTS)
  assert.deepEqual(publish(definition, state), {
    kind: 'turn',
    turn: 7,
    key: 'turn-summary',
    value: {
      turn: 7,
      skillCallCount: 1,
      skillNames: ['dsh-client-ui-ux'],
      unreadableSkillCalls: 0,
      pluginNames: [],
      toolCounts: [
        { name: 'read', count: 2 },
        { name: 'grep', count: 1 },
      ],
    },
  })
})

test('黄金输出：渲染出的那一行', () => {
  const state = foldEvents(definition, GOLDEN_EVENTS)
  const location = publish(definition, state)
  const vnode = component({ turn: createTurn(7, location.value), t })
  assert.equal(
    toHtml(vnode),
    `<div class="${CSS_ROOT_CLASS}" data-turn-summary="7" data-turn-summary-skill-calls="1"`
    + ' data-turn-summary-tool-calls="3">本轮 · skill: dsh-client-ui-ux ｜ 工具: read×2, grep×1</div>',
  )
})

test('渲染行的 data 属性分别承载轮次、skill 次数与工具总次数', () => {
  const state = foldEvents(definition, GOLDEN_EVENTS)
  const location = publish(definition, state)
  const vnode = component({ turn: createTurn(7, location.value), t })
  assert.equal(vnode.type, 'div')
  assert.equal(vnode.props.className, CSS_ROOT_CLASS)
  assert.equal(vnode.props['data-turn-summary'], 7)
  assert.equal(vnode.props['data-turn-summary-skill-calls'], 1)
  assert.equal(vnode.props['data-turn-summary-tool-calls'], 3)
})

test('无 skill 无工具时显式写「无」', () => {
  const state = foldEvents(definition, [turnStart(3, 10)])
  const location = publish(definition, state)
  const vnode = component({ turn: createTurn(3, location.value), t })
  assert.equal(vnode.props.children, '本轮 · skill: 无 ｜ 工具: 无')
})

test('没有归属来源时 pluginNames 恒为空，界面上不出现「插件」段', () => {
  const state = foldEvents(definition, GOLDEN_EVENTS)
  const location = publish(definition, state)
  assert.deepEqual(location.value.pluginNames, [])
  const vnode = component({ turn: createTurn(7, location.value), t })
  assert.ok(!vnode.props.children.includes('插件'))
  assert.ok(!vnode.props.children.includes('plugins'))
})

/**
 * The honest step-one seam inside the shipped artifact: the default
 * tool-owner resolver reports "unknown owner" for every tool.
 */
const DEFAULT_OWNER_SEAM = '{ ownersOf: () => [] }'

/** The same seam with a probe owner, so `pluginNames` has something to report. */
const PROBE_OWNER_SEAM = '{ ownersOf: () => ["probe-plugin"] }'

test('pluginNames 是算出来的：把产物的缺省归属解析器换成探针后，pluginNames 必须带上探针名', () => {
  const occurrences = CLIENT_ARTIFACT_SOURCE.split(DEFAULT_OWNER_SEAM).length - 1
  assert.equal(occurrences, 1, '产物的缺省归属解析器写法变了，探针用例需要同步')
  const probed = loadArtifact(CLIENT_ARTIFACT_SOURCE.replace(DEFAULT_OWNER_SEAM, PROBE_OWNER_SEAM))
  const probedDefinition = probed.context.definitionRegistrations[0]
  const location = publish(probedDefinition, foldEvents(probedDefinition, GOLDEN_EVENTS))
  assert.deepEqual(location.value.pluginNames, ['probe-plugin'])
})

test('pluginNames 非空时，渲染行出现「插件」段', () => {
  const probed = loadArtifact(CLIENT_ARTIFACT_SOURCE.replace(DEFAULT_OWNER_SEAM, PROBE_OWNER_SEAM))
  const probedDefinition = probed.context.definitionRegistrations[0]
  const probedComponent = probed.context.slotRegistrations[0].component
  const probedT = createTranslator(probed.context.localeRegistrations[0].dictionary.zh)
  const location = publish(probedDefinition, foldEvents(probedDefinition, GOLDEN_EVENTS))
  const vnode = probedComponent({ turn: createTurn(7, location.value), t: probedT })
  assert.equal(
    vnode.props.children,
    '本轮 · skill: dsh-client-ui-ux ｜ 插件: probe-plugin ｜ 工具: read×2, grep×1',
  )
})

test('skill 参数 JSON 非法：计数照加，记为未识别，不记名', () => {
  const state = foldEvents(definition, [
    turnStart(1, 1),
    toolCall(1, 2, 'skill', '{not json'),
  ])
  assert.equal(state.skillCallCount, 1)
  assert.equal(state.unreadableSkillCalls, 1)
  assert.deepEqual(state.skillNames, [])
})

/**
 * The exact folded state every unreadable `skill` call must produce.
 * @param {number} turn - turn number.
 * @returns {object} the expected state.
 */
function unreadableSkillState(turn) {
  return {
    turn,
    startSeq: 1,
    skillCallCount: 1,
    skillNames: [],
    unreadableSkillCalls: 1,
    toolCounts: [],
  }
}

/** Malformed `skill` arguments: each one must be counted, never named. */
const MALFORMED_SKILL_ARGUMENTS = [
  { title: 'name 不是字符串', payload: '{"name":123}' },
  { title: '没有 name 键', payload: '{"foo":"bar"}' },
  { title: '顶层是数组', payload: '["a"]' },
  { title: 'name 全是空白', payload: '{"name":"   "}' },
  { title: '顶层不是对象', payload: '123' },
  { title: '顶层是 null', payload: 'null' },
]

for (const { title, payload } of MALFORMED_SKILL_ARGUMENTS) {
  test(`skill 参数畸形（${title}）：计数照加、记为未识别、不记假名`, () => {
    const state = foldEvents(definition, [
      turnStart(1, 1),
      toolCall(1, 2, 'skill', payload),
    ])
    assert.deepEqual(state, unreadableSkillState(1))
    assert.equal(state.skillCallCount, 1)
    assert.equal(state.unreadableSkillCalls, 1)
    assert.deepEqual(state.skillNames, [])
  })
}

test('skill 参数合法（正向对照）：名字被记下、不可读计数为 0', () => {
  const state = foldEvents(definition, [
    turnStart(1, 1),
    toolCall(1, 2, 'skill', JSON.stringify({ name: 'ok-skill' })),
  ])
  assert.deepEqual(state, {
    turn: 1,
    startSeq: 1,
    skillCallCount: 1,
    skillNames: ['ok-skill'],
    unreadableSkillCalls: 0,
    toolCounts: [],
  })
})

test('合法与畸形参数混在一起：各记各的，畸形的不污染名字列表', () => {
  const state = foldEvents(definition, [
    turnStart(1, 1),
    toolCall(1, 2, 'skill', JSON.stringify({ name: 'ok-skill' })),
    toolCall(1, 3, 'skill', '{"name":123}'),
  ])
  assert.equal(state.skillCallCount, 2)
  assert.equal(state.unreadableSkillCalls, 1)
  assert.deepEqual(state.skillNames, ['ok-skill'])
})

test('skill 参数超过 4096 字符：整条记为未识别', () => {
  const long = JSON.stringify({ name: 'x', pad: 'a'.repeat(4100) })
  assert.ok(long.length > 4096)
  const state = foldEvents(definition, [
    turnStart(1, 1),
    toolCall(1, 2, 'skill', long),
  ])
  assert.equal(state.skillCallCount, 1)
  assert.equal(state.unreadableSkillCalls, 1)
  assert.deepEqual(state.skillNames, [])
})

test('skill 参数恰好 4096 字符：仍可解析出名字', () => {
  const head = '{"name":"edge","pad":"'
  const tail = '"}'
  const args = head + 'a'.repeat(4096 - head.length - tail.length) + tail
  assert.equal(args.length, 4096)
  const state = foldEvents(definition, [
    turnStart(1, 1),
    toolCall(1, 2, 'skill', args),
  ])
  assert.equal(state.skillCallCount, 1)
  assert.equal(state.unreadableSkillCalls, 0)
  assert.deepEqual(state.skillNames, ['edge'])
})

test('skill 名超过 120 码点：按码点截断到 120（不是按字节）', () => {
  const name = '😀'.repeat(130)
  const state = foldEvents(definition, [
    turnStart(1, 1),
    toolCall(1, 2, 'skill', JSON.stringify({ name })),
  ])
  assert.equal(state.skillCallCount, 1)
  assert.equal(state.unreadableSkillCalls, 0)
  assert.equal(state.skillNames.length, 1)
  assert.equal(Array.from(state.skillNames[0]).length, 120)
  assert.equal(state.skillNames[0].length, 240)
  assert.notEqual(state.skillNames[0], name)
})

test('不同 skill 名超过 16 个：第 17 个不再记名，但调用计数照加', () => {
  const events = [turnStart(1, 1)]
  for (let index = 0; index < 17; index += 1) {
    events.push(toolCall(1, 2 + index, 'skill', JSON.stringify({ name: `skill-${index}` })))
  }
  const state = foldEvents(definition, events)
  assert.equal(state.skillCallCount, 17)
  assert.equal(state.skillNames.length, 16)
  assert.deepEqual(state.skillNames[0], 'skill-0')
  assert.deepEqual(state.skillNames[15], 'skill-15')
})

test('同名 skill 重复加载：名字只记一次，调用计数累加', () => {
  const state = foldEvents(definition, [
    turnStart(1, 1),
    toolCall(1, 2, 'skill', JSON.stringify({ name: 'demo' })),
    toolCall(1, 3, 'skill', JSON.stringify({ name: 'demo' })),
  ])
  assert.equal(state.skillCallCount, 2)
  assert.deepEqual(state.skillNames, ['demo'])
})

test('turn/start 重置状态：fork 继承的历史不计入新一轮', () => {
  const state = foldEvents(definition, [
    turnStart(1, 1),
    toolCall(1, 2, 'read', '{}'),
    turnStart(2, 10),
    toolCall(2, 11, 'grep', '{}'),
  ])
  assert.equal(state.turn, 2)
  assert.equal(state.startSeq, 10)
  assert.deepEqual(state.toolCounts, [{ name: 'grep', count: 1 }])
})

test('event.turn !== state.turn 的事件被忽略', () => {
  const state = foldEvents(definition, [
    turnStart(7, 100),
    toolCall(8, 101, 'read', '{}'),
  ])
  assert.deepEqual(state.toolCounts, [])
})

test('event.seq < state.startSeq 的事件被忽略（继承历史）', () => {
  const state = foldEvents(definition, [
    turnStart(7, 100),
    toolCall(7, 99, 'read', '{}'),
  ])
  assert.deepEqual(state.toolCounts, [])
})

test('turn/end 不改变状态', () => {
  const before = foldEvents(definition, [turnStart(7, 100)])
  const after = definition.update({ state: before }, { event: turnEnd(7, 101) })
  assert.equal(after, before)
})

test('与本插件无关的事件不改变状态', () => {
  const before = foldEvents(definition, [turnStart(7, 100)])
  const after = definition.update({ state: before }, { event: unrelated(101) })
  assert.equal(after, before)
})

test('工具名保留首次使用顺序', () => {
  const state = foldEvents(definition, [
    turnStart(7, 100),
    toolCall(7, 101, 'read', '{}'),
    toolCall(7, 102, 'grep', '{}'),
    toolCall(7, 103, 'read', '{}'),
  ])
  assert.deepEqual(state.toolCounts, [
    { name: 'read', count: 2 },
    { name: 'grep', count: 1 },
  ])
})

test('skill 调用不计入工具段', () => {
  const state = foldEvents(definition, GOLDEN_EVENTS)
  assert.ok(!state.toolCounts.some((tool) => tool.name === 'skill'))
  assert.equal(state.toolCounts.length, 2)
})

test('空白工具名被忽略', () => {
  const before = foldEvents(definition, [turnStart(7, 100)])
  const after = definition.update({ state: before }, { event: toolCall(7, 101, '   ', '{}') })
  assert.equal(after, before)
})

test('skill 名字无法识别时，skill 段显示「未知」', () => {
  const state = foldEvents(definition, [
    turnStart(1, 1),
    toolCall(1, 2, 'skill', '{oops'),
  ])
  const location = publish(definition, state)
  const vnode = component({ turn: createTurn(1, location.value), t })
  assert.equal(vnode.props.children, '本轮 · skill: 未知 ｜ 工具: 无')
})

test('可识别与不可识别的 skill 同时存在时，「未知」追加在名字列表末尾', () => {
  const state = foldEvents(definition, [
    turnStart(1, 1),
    toolCall(1, 2, 'skill', JSON.stringify({ name: 'alpha' })),
    toolCall(1, 3, 'skill', '{oops'),
  ])
  const location = publish(definition, state)
  const vnode = component({ turn: createTurn(1, location.value), t })
  assert.equal(vnode.props.children, '本轮 · skill: alpha, 未知 ｜ 工具: 无')
})

test('Definition 的 match：turn/start 得到 role start', () => {
  const match = definition.match['turn/start'](turnStart(7, 100))
  assert.deepEqual(match, { id: '7', role: 'start' })
})

test('Definition 的 match：tool/call 与 turn/end 得到 role update', () => {
  assert.deepEqual(definition.match['tool/call'](toolCall(7, 101, 'read')), {
    id: '7',
    role: 'update',
  })
  assert.deepEqual(definition.match['turn/end'](turnEnd(7, 102)), {
    id: '7',
    role: 'update',
  })
})

test('Definition 的 match：无关事件得到 null', () => {
  assert.equal(definition.match['turn/start'](unrelated(1)), null)
  assert.equal(definition.match['tool/call'](unrelated(1)), null)
  assert.equal(definition.match['turn/end'](unrelated(1)), null)
})

test('Definition 的 start 只接受 turn/start，否则抛错', () => {
  assert.throws(
    () => definition.start({}, { event: toolCall(7, 101, 'read') }),
    /turn-summary start requires turn\/start/,
  )
})

test('buildLocationData：scope 不是 turn 或没有状态时返回 null', () => {
  const state = foldEvents(definition, GOLDEN_EVENTS)
  assert.equal(definition.buildLocationData({ state }, 'global', undefined), null)
  assert.equal(definition.buildLocationData({ state: undefined }, 'turn', undefined), null)
})

test('buildLocationData：事实未变时复用 previous，保持对象身份', () => {
  const state = foldEvents(definition, GOLDEN_EVENTS)
  const first = publish(definition, state)
  const second = publish(definition, state, first)
  assert.equal(second, first)
})

test('buildLocationData：事实变化时发布新对象', () => {
  const first = publish(definition, foldEvents(definition, GOLDEN_EVENTS))
  const state = foldEvents(definition, [...GOLDEN_EVENTS, toolCall(7, 105, 'write', '{}')])
  const second = publish(definition, state, first)
  assert.notEqual(second, first)
  assert.equal(second.value.toolCounts.length, 3)
})

test('中文词典逐字正确', () => {
  assert.equal(zh.line, '本轮 · skill: {skill} ｜ 工具: {tools}')
  assert.equal(zh['line.withPlugins'], '本轮 · skill: {skill} ｜ 插件: {plugins} ｜ 工具: {tools}')
  assert.equal(zh.none, '无')
  assert.equal(zh.unreadable, '未知')
  assert.equal(zh.separator, ', ')
  assert.equal(zh.toolCount, '{name}×{count}')
})
