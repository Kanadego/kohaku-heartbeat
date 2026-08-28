// 琥珀的心跳 · 输入流接口约定 v1
//
// 每个输入流是一个 .mjs 文件，默认导出 collect()：
//
//   export default function collect(policy, now = new Date()) {
//     return {
//       source: '流名',            // 素材来源标识
//       items: [                   // 候选素材（经 seeds.add 入池，走去重/TTL/容量）
//         { text: '...', weight?: 1 },
//       ],
//       context: { ... },          // 反刍参考上下文（不入素材池，仅供思考）
//     };
//   }
//
// 约定：
// - items 必须自带"真实来处"，宁缺毋滥；
// - context 只描述事实，不做决策；决策在 core/gate。
// - 流本身不做隐私采集越界检查之外的任何 IO 以外的重活；
//   所有网络请求只允许 GET 公开资源。
