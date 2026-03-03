import { readFileSync } from "node:fs";
import { ParsedCardData } from "./types";
import { logger } from "../utils/logger";

function parsePngMetadataFromBuffer(
  buffer: Buffer,
  filePath: string
): ParsedCardData | null {
  try {
    if (
      buffer.length < 8 ||
      buffer.toString("hex", 0, 8) !== "89504e470d0a1a0a"
    ) {
      logger.errorMessageKey("error.png.invalidPng", { filePath });
      return null;
    }

    const textChunks: Array<{ keyword: string; text: string }> = [];
    let position = 8;

    while (position < buffer.length - 12) {
      const chunkLength = buffer.readUInt32BE(position);
      position += 4;

      const chunkType = buffer.toString("ascii", position, position + 4);
      position += 4;

      if (chunkType === "tEXt") {
        if (buffer.length < position + chunkLength + 4) {
          logger.errorMessageKey("error.png.textChunkInsufficientData", {
            filePath,
          });
          return null;
        }

        const chunkData = buffer.slice(position, position + chunkLength);
        const nullIndex = chunkData.indexOf(0);
        if (nullIndex > 0 && nullIndex < chunkData.length - 1) {
          const keyword = chunkData.slice(0, nullIndex).toString("ascii");
          const text = chunkData.slice(nullIndex + 1).toString("latin1");
          if (
            keyword.toLowerCase() === "ccv3" ||
            keyword.toLowerCase() === "chara"
          ) {
            textChunks.push({ keyword: keyword.toLowerCase(), text });
          }
        }

        position += chunkLength + 4;
      } else if (chunkType === "IEND") {
        break;
      } else {
        if (buffer.length >= position + chunkLength + 4) {
          position += chunkLength + 4;
        } else {
          break;
        }
      }
    }

    const ccv3Chunk = textChunks.find((chunk) => chunk.keyword === "ccv3");
    if (ccv3Chunk) {
      try {
        const decodedData = Buffer.from(ccv3Chunk.text, "base64").toString(
          "utf-8"
        );
        const cardData = JSON.parse(decodedData);

        let specVersion: "1.0" | "2.0" | "3.0" | "UNKNOWN" = "UNKNOWN";
        if (cardData.spec === "chara_card_v3") {
          specVersion = "3.0";
        } else if (cardData.spec === "chara_card_v2") {
          specVersion = "2.0";
        } else if (!cardData.spec) {
          const v1RequiredFields = [
            "name",
            "description",
            "personality",
            "scenario",
            "first_mes",
            "mes_example",
          ];
          const hasAllV1Fields = v1RequiredFields.every((field) =>
            cardData.hasOwnProperty(field)
          );
          if (hasAllV1Fields) {
            specVersion = "1.0";
          }
        }

        return {
          data: cardData,
          spec_version: specVersion,
          chunk_type: "ccv3",
        };
      } catch (error) {
        logger.errorKey(error, "error.png.decodeCcv3Failed", { filePath });
      }
    }

    const charaChunk = textChunks.find((chunk) => chunk.keyword === "chara");
    if (charaChunk) {
      try {
        const decodedData = Buffer.from(charaChunk.text, "base64").toString(
          "utf-8"
        );
        const cardData = JSON.parse(decodedData);

        let specVersion: "1.0" | "2.0" | "3.0" | "UNKNOWN" = "UNKNOWN";
        if (cardData.spec === "chara_card_v2") {
          specVersion = "2.0";
        } else if (cardData.spec === "chara_card_v3") {
          specVersion = "3.0";
        } else if (!cardData.spec) {
          const v1RequiredFields = [
            "name",
            "description",
            "personality",
            "scenario",
            "first_mes",
            "mes_example",
          ];
          const hasAllV1Fields = v1RequiredFields.every((field) =>
            cardData.hasOwnProperty(field)
          );
          if (hasAllV1Fields) {
            specVersion = "1.0";
          }
        }

        return {
          data: cardData,
          spec_version: specVersion,
          chunk_type: "chara",
        };
      } catch (error) {
        logger.errorKey(error, "error.png.decodeCharaFailed", { filePath });
        return null;
      }
    }

    return null;
  } catch (error) {
    logger.errorKey(error, "error.png.parseFailed", { filePath });
    return null;
  }
}

/**
 * Парсит метаданные карточки из PNG файла
 * Читает текстовые чанки tEXt без полного декодирования изображения
 * Поддерживает приоритет версий: сначала ищет ccv3 (V3), затем chara (V2)
 * @param filePath Путь к PNG файлу
 * @returns Парсированные данные карточки или null в случае ошибки
 */
export function parsePngMetadata(filePath: string): ParsedCardData | null {
  try {
    const buffer = readFileSync(filePath);
    return parsePngMetadataFromBuffer(buffer, filePath);
  } catch (error) {
    logger.errorKey(error, "error.png.parseFailed", { filePath });
    return null;
  }
}

export function parsePngMetadataBuffer(
  buffer: Buffer,
  sourceLabel = "[buffer]"
): ParsedCardData | null {
  return parsePngMetadataFromBuffer(buffer, sourceLabel);
}
