import { GoogleGenAI } from "@google/genai";
import { blobToBase64 } from "../utils/audioUtils";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const MODEL_NAME = 'gemini-2.5-flash';

export const transcribeAudioToUrdu = async (audioBlob: Blob): Promise<string> => {
  try {
    const base64Audio = await blobToBase64(audioBlob);
    
    // Determine mime type (defaulting to webm if not present on blob)
    const mimeType = audioBlob.type || 'audio/webm';

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType,
              data: base64Audio
            }
          },
          {
            text: "Listen to the speech in this audio carefully. Transcribe the speech directly into Urdu script. If the language spoken is not Urdu (e.g., English), translate it accurately into Urdu. Return ONLY the Urdu text response, no other commentary."
          }
        ]
      }
    });

    const text = response.text;
    if (!text) {
      throw new Error("No transcription generated.");
    }

    return text.trim();
  } catch (error) {
    console.error("Gemini Transcription Error:", error);
    throw error;
  }
};

export const summarizeUrduContent = async (segments: string[]): Promise<string> => {
  try {
    const joinedText = segments.join("\n\n");
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: {
        parts: [
          {
            text: `Here is a list of transcriptions in Urdu:\n\n${joinedText}\n\nPlease provide a concise summary of all these points in Urdu script.`
          }
        ]
      }
    });

    const text = response.text;
    if (!text) return "Could not generate summary.";
    return text.trim();
  } catch (error) {
    console.error("Gemini Summary Error:", error);
    throw error;
  }
};
