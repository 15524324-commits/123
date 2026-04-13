import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface QuestionVariation {
  question: string;
  answer: string;
  analysis: string;
}

export interface OCRResult {
  text: string;
  knowledgePoint: string;
}

export async function performOCR(base64Image: string): Promise<OCRResult> {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      {
        parts: [
          { text: "请识别图片中的题目内容。提取题目文本，并判断该题所属的知识点。请以 JSON 格式返回，包含 'text' 和 'knowledgePoint' 两个字段。不要包含 Markdown 代码块。" },
          { inlineData: { mimeType: "image/jpeg", data: base64Image } }
        ]
      }
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          text: { type: Type.STRING },
          knowledgePoint: { type: Type.STRING }
        },
        required: ["text", "knowledgePoint"]
      }
    }
  });

  return JSON.parse(response.text || "{}");
}

export async function generateVariations(originalQuestion: string, knowledgePoint: string): Promise<QuestionVariation[]> {
  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: `原题内容：${originalQuestion}\n知识点：${knowledgePoint}\n\n请基于该知识点生成 3 道相似的“举一反三”题目。要求：\n1. 覆盖同一知识点的不同角度或变式。\n2. 难度与原题相当或略有梯度。\n3. 每道题附带正确答案，以及侧重易错点的解析（例如“本题常见错误是忘记讨论二次项系数为零的情况”）。\n\n请以 JSON 格式返回一个数组，每个元素包含 'question', 'answer', 'analysis' 字段。不要包含 Markdown 代码块。`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            question: { type: Type.STRING },
            answer: { type: Type.STRING },
            analysis: { type: Type.STRING }
          },
          required: ["question", "answer", "analysis"]
        }
      }
    }
  });

  return JSON.parse(response.text || "[]");
}
