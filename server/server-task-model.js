function createTaskModelInvoker({ callLocalModelWithTools }) {
  return async function callLocalModelForTask(task) {
    const taskTools = [
      {
        type: "function",
        function: {
          name: "get_weather",
          description: "Get current weather for a city or location.",
          parameters: {
            type: "object",
            properties: {
              location: { type: "string" },
            },
            required: ["location"],
          },
        },
      },
    ];

    return await callLocalModelWithTools({
      model: task.model,
      messages: [
        {
          role: "system",
          content: "浣犳鍦ㄦ墽琛屼竴涓畾鏃朵换鍔★紝鐢熸垚鐨勫唴瀹逛細鐩存帴鎺ㄩ€佺粰鏈€缁堢敤鎴枫€傝鐩存帴杈撳嚭瑕佸彂閫佺粰鐢ㄦ埛鐨勭粨鏋滄垨鎻愰啋鍐呭锛屼笉瑕佹妸鑷繁褰撴垚琚彁閱掔殑浜猴紝涔熶笉瑕佸洖澶嶁€滃ソ鐨勩€佹敹鍒般€佹槑鐧戒簡鈥濊繖绫昏嚜鎴戝簲绛斻€傞渶瑕佸疄鏃跺ぉ姘旀椂锛岃璋冪敤 get_weather 宸ュ叿锛屼笉瑕佸嚟绌虹寽娴嬪ぉ姘斻€?",
        },
        {
          role: "user",
          content: task.prompt,
        },
      ],
      tools: taskTools,
    });
  };
}

module.exports = {
  createTaskModelInvoker,
};
