
项目说明书｜实时转写 + 翻译（Next.js + Soniox）

目标读者：前端/全栈工程师、Tech Lead、QA。
发布：v1.0（2025-10-09 JST）

⸻

0. 项目目标（What & Why）
	•	做什么：一个基于 Next.js 的实时语音字幕工具，左侧显示原语言转写，右侧显示翻译后的目标语言。
	•	语言范围：中文（zh）、英语（en）、日语（ja），支持混说与自动识别。
	•	核心能力：
	1.	浏览器采集麦克风 → 实时 WebSocket → 收到增量转写（partial/final）；
	2.	同步开启实时翻译（one-way 统一到目标语；或 two-way 英↔日互译，后续可扩展）；
	3.	60 分钟会话自动续流（实时 API 单路时长上限），不断字；
	4.	低成本：计费按 token（输入音频 + 输出文本），与语言无关。
	•	不做什么（v1）：TTS 朗读、录制回放、账号体系、多会话协作、复杂标注/编辑。

⸻

1. 架构概览（Next.js 既前端又后端）

[Browser Frontend]
  ├─ getUserMedia() 采集音频
  ├─ 调用 /api/soniox-temp-key 获取“短效临时API Key”
  ├─ 直连 wss://stt-rt.soniox.com/transcribe-websocket
  │    → 发送配置JSON（语言识别/翻译/说话人分离等）
  │    → 持续推音频帧（PCM/Opus/auto）
  │    ← 收流式结果：原文token/翻译token（partial/final）
  └─ UI：左栏显示原文，右栏显示翻译；状态栏显示延迟/会话计时

[Next.js API Routes]
  └─ POST /api/soniox-temp-key
       使用后端保管的长期 SONIOX_API_KEY 向官方 Auth 接口
       创建“临时API Key”（数分钟有效）；返回给前端

为何要“临时 Key”：避免在浏览器暴露长期密钥，同时保持“前端直连 Soniox”的最低端到端延迟。

⸻

2. 功能清单与验收标准
	•	实时转写（必选）：
	•	延迟：从讲话到 partial 文本呈现 ≤ 800 ms（典型网络）。
	•	正确性：中英日三语口音混说不过度“错语种”；final 稳定合并。
	•	实时翻译（可开关）：
	•	one-way：任意语音 → 统一翻译到 UI 右侧目标语（默认：英文）。
	•	two-way：英↔日互译（v1 只保留参数门，以后再做 UI）。
	•	会话续流：
	•	单路 55 分钟时预起新流，完成无缝切换；整场多小时不中断。
	•	说话人分离/时间戳（可开关）：
	•	UI 在左侧原文前方显示 S1: S2:；行内轻度防抖（同一说话人连续发言合并）。
	•	错误回退：
	•	断线自动重连（指数退避≤8s），音频缓冲回补；失败进入“离线上传（async/file）”按钮提示。

⸻

3. 数据流 & 状态机（关键时序）
	1.	REC_IDLE → 用户点击开始 → FETCH_TEMP_KEY：POST /api/soniox-temp-key。
	2.	WS_CONNECTING：用临时 key 建立 WebSocket；发送配置 JSON：

{
  "api_key": "<temporary_key>",
  "model": "stt-rt-preview",
  "audio_format": "auto",
  "enable_language_identification": true,
  "language_hints": ["zh", "en", "ja"],
  "enable_speaker_diarization": true,
  "translation": { "type": "one_way", "target_language": "en" }
}


	3.	STREAMING：持续发送音频帧（20–40ms/帧），接收 partial/final 结果：
	•	原文 token（translation_status = "original"）：左栏；
	•	翻译 token（translation_status = "translation"）：右栏；
	•	speaker、language、start/end_ms 用于 UI 标注与分段。
	4.	ROTATE_SESSION（T≈55min）：并行拉起新会话（B），旧会话（A）收尾；UI 拼接。
	5.	STOPPING：发送结束帧，等待 final flush；转 REC_IDLE。

⸻

4. Next.js 实现（目录、接口、关键代码）

4.1 目录建议

/app
  /api
    /soniox-temp-key/route.ts  // 签发临时API Key
  /page.tsx                    // 主界面（左右双栏）
  /ws-client.ts                // WebSocket 客户端封装（可选）
/lib
  /audio/recorder.ts           // MediaRecorder/Worklet 封装
  /soniox/schema.ts            // 类型与结果解析
  /soniox/rotator.ts           // 60min 会话续流器

4.2 后端：签发临时 API Key（/api/soniox-temp-key）

// /app/api/soniox-temp-key/route.ts
export async function POST() {
  const res = await fetch('https://api.soniox.com/v1/auth/temporary-api-key', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.SONIOX_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      usage_type: 'transcribe_websocket',
      expires_in_seconds: 300,           // 5 分钟有效
      client_reference_id: 'web-live-stt'
    })
  });
  if (!res.ok) {
    const err = await res.text();
    return new Response(JSON.stringify({ error: err }), { status: 500 });
  }
  const data = await res.json(); // { api_key, expires_at }
  return Response.json({ apiKey: data.api_key });
}

4.3 前端：两栏 UI（核心片段）

'use client';
import { useEffect, useRef, useState } from 'react';

export default function Page() {
  const wsRef = useRef<WebSocket | null>(null);
  const [targetLang, setTargetLang] = useState<'en'|'zh'|'ja'>('en');
  const [orig, setOrig] = useState('');
  const [tran, setTran] = useState('');

  async function start() {
    // 1) 拿临时 Key
    const { apiKey } = await fetch('/api/soniox-temp-key', { method: 'POST' })
      .then(r => r.json());

    // 2) 建立 WS
    const ws = new WebSocket('wss://stt-rt.soniox.com/transcribe-websocket');
    wsRef.current = ws;

    ws.onopen = async () => {
      // 3) 发配置
      ws.send(JSON.stringify({
        api_key: apiKey,
        model: 'stt-rt-preview',
        audio_format: 'auto',
        enable_language_identification: true,
        language_hints: ['zh','en','ja'],
        enable_speaker_diarization: true,
        translation: { type: 'one_way', target_language: targetLang }
      }));

      // 4) 采集音频并推送二进制帧（Opus/PCM，示例用 MediaRecorder → Ogg/Opus）
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      rec.ondataavailable = (e) => e.data && ws.send(e.data);
      rec.start(250); // 每 250ms 一个 chunk
    };

    // 5) 处理结果
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      for (const t of (msg.tokens ?? [])) {
        if (t.translation_status === 'translation') setTran(p => p + t.text);
        else setOrig(p => p + t.text);
      }
    };

    ws.onerror = (e) => console.error('ws error', e);
    ws.onclose = () => console.log('ws closed');
  }

  function stop() { wsRef.current?.close(); wsRef.current = null; }

  return (
    <div className="grid grid-cols-2 gap-4 p-6">
      <section>
        <header className="font-semibold mb-2">原文</header>
        <pre className="whitespace-pre-wrap text-sm">{orig}</pre>
      </section>
      <section>
        <header className="font-semibold mb-2">翻译（{targetLang}）</header>
        <pre className="whitespace-pre-wrap text-sm">{tran}</pre>
      </section>
      <div className="col-span-2 flex gap-2 items-center">
        <select value={targetLang} onChange={e => setTargetLang(e.target.value as any)}>
          <option value="en">English</option>
          <option value="zh">中文</option>
          <option value="ja">日本語</option>
        </select>
        <button onClick={start}>开始</button>
        <button onClick={stop}>停止</button>
      </div>
    </div>
  );
}

说明：生产环境建议改用 AudioWorklet/ScriptProcessor 做 20–40ms 帧推送，进一步降低端到端延迟；以上为易懂的 MVP 片段。

4.4 60 分钟自动续流（核心思路）
	•	在 STREAMING 状态启动计时；到 T=55min：
	•	建立第二条连接（B），重复发送相同配置；
	•	前端本地仍采集同一麦克风，同时推给 A 与 B（双写 ~10–15 秒）；
	•	待 B 收到稳定 partial 后，关闭 A；
	•	UI 按 session_id 进行段落拼接，避免文字跳跃。

⸻

5. 语言与翻译策略
	•	混说识别：开启 enable_language_identification，并传 language_hints: ["zh","en","ja"]；模型会在 token 上标注 language。
	•	one-way 翻译（推荐做 UI 右栏）：translation: { type: 'one_way', target_language: 'en' }。
	•	two-way 翻译（英↔日实况口译）：translation: { type: 'two_way', language_a: 'en', language_b: 'ja' }。
	•	成本：启用翻译不会产生功能附加费；只会因为多生成“翻译文本”而增加输出文本 token计费（与语种无关）。

⸻

6. 成本与配额（工程可控项）
	•	计费模型：
	•	实时：输入音频 ~$2.00 / 1M tokens；输出文本 ~$4.00 / 1M tokens。
	•	换算（典型语速）：~$0.12 / 小时（仅转写，含原文文本）；若加“原文+译文”，输出 tokens 近似翻倍，约 ~$0.18 / 小时。
	•	节流建议：
	•	空档断流或降采样（避免“空烧时长”）；
	•	UI 提供“仅转写/转写+翻译”开关；
	•	热词/上下文适量，不要推超长提示（输入文本 token 也计费）。
	•	配额/上限：单路 60 分钟；并发路数/RPM 有默认配额（可申请上调）。

⸻

7. 错误处理与稳健性
	•	网络：断线自动重连（1s/2s/4s/8s 退避）；缓冲本地 3–5s 音频帧，重连后回补。
	•	服务器响应：对 onPartial/onFinal 区分处理；final 到来前不要立刻“落墨定型”。
	•	后台切换：浏览器挂起时 MediaRecorder 可能降频；监控 onpause/onresume 事件，必要时提示用户。
	•	浏览器兼容：Chrome/Edge 优先；Safari 下建议使用 Web Audio + 音频编码库（如 WebCodecs/ogg-opus wasm）。

⸻

8. 安全与合规
	•	密钥：长期 SONIOX_API_KEY 仅存服务器；前端只用临时 key（几分钟过期）。
	•	CSP：允许 wss 到官方域名，限制第三方脚本；
	•	隐私：v1 不落盘；如需审计，保存纯文本字幕并在设置中提示用户；
	•	GDPR/合同：若进入企业场景，补充数据处理说明（DPA）、保留期与删除策略。

⸻

9. QA 测试清单（抽样）
	•	中/英/日三语单语；三种混说（zh→en→ja）连续 30 秒；
	•	双人/三人抢话 + 背景噪声（咖啡店/风声）；
	•	55 分钟自动续流，检查是否丢句；
	•	断网 5 秒、30 秒场景：是否自动重连且回补；
	•	开启/关闭翻译的成本差异核算；
	•	Diarization 开/关，是否稳定标注同一说话人。

⸻

10. 里程碑与交付
	•	M0（2 天）：临时 Key 后端 + 前端直连 WS，原文 partial 展示。
	•	M1（+2 天）：右栏 one-way 翻译、语言提示/自动识别、基本样式。
	•	M2（+3 天）：续流器、断线重连、成本统计（时长×估算 token）。
	•	M3（+3 天）：说话人分离、时间戳、导出（TXT/JSON）。

⸻

11. 环境与配置
	•	Node 18+ / Next.js 14+（App Router）。
	•	环境变量：SONIOX_API_KEY；（可选）SAMPLE_RATE、LOG_LEVEL。
	•	部署：Vercel / 自托管（保持到官方 wss 出口）。

⸻

12. 后续路线（v1.1+）
	•	双向翻译（two-way）UI；
	•	轻量“术语表/热词”接口（后端透传到 context）；
	•	会议纪要生成（摘要/行动项，异步任务，不阻塞实时流）。

⸻

附录：结果消息常见字段（示例）

{
  "type": "result",
  "tokens": [
    {
      "text": "こんにちは",
      "language": "ja",
      "speaker": 1,
      "start_ms": 1200,
      "end_ms": 1800,
      "final": false,
      "translation_status": "original"
    },
    {
      "text": "Hello",
      "language": "en",
      "translation_status": "translation"
    }
  ]
}

实际字段名/结构以线上版本为准；工程侧应做向后兼容解析与“未知字段忽略”。

API KEY 363c221fb2b5c42e7c58dc9db65a45f6b87519903228fee734e22109e2b2c793