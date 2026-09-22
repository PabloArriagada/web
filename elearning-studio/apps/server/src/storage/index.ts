import type { Config } from "../config.js";
import { FsStorage } from "./fs.js";
import { S3Storage } from "./s3.js";
import type { ObjectStorage } from "./types.js";

export function createStorage(cfg: Config): ObjectStorage {
  if (cfg.STORAGE_DRIVER === "s3") {
    return new S3Storage({
      ...(cfg.S3_ENDPOINT ? { endpoint: cfg.S3_ENDPOINT } : {}),
      region: cfg.S3_REGION,
      bucket: cfg.S3_BUCKET,
      accessKeyId: cfg.S3_ACCESS_KEY_ID!,
      secretAccessKey: cfg.S3_SECRET_ACCESS_KEY!,
      forcePathStyle: cfg.S3_FORCE_PATH_STYLE,
    });
  }
  return new FsStorage(cfg.STORAGE_FS_ROOT);
}

export type { ObjectStorage } from "./types.js";
