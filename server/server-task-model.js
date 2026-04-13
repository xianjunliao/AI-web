function createTaskModelInvoker({ callLocalModelWithTools, getTaskModel }) {
  return async function callLocalModelForTask(task) {
    const model = String(
      typeof getTaskModel === "function"
        ? getTaskModel(task)
        : ""
    ).trim();
    if (!model) {
      const error = new Error("Base connection model is not configured");
      error.statusCode = 400;
      throw error;
    }

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
      model,
      messages: [
        {
          role: "system",
          content: [
            "浣犳鍦ㄦ墽琛屼竴涓畾鏃朵换鍔°€傝鐩存帴瀹屾垚浠诲姟锛屼笉瑕佸彧瑙ｉ噴鑳藉姏闄愬埗銆?",
            "濡傛灉鐢ㄦ埛浠诲姟娑夊強澶╂皵锛屽彲浠ヨ皟鐢?get_weather銆?",
          ].join("\n"),
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
