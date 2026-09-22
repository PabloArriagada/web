import { createReadStream } from "node:fs";
import { stat as fsStat } from "node:fs/promises";
import { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { assertSafeKey, type ByteRange, type ObjectStorage } from "./types.js";

export type S3Config = {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
};

/** Driver S3 (AWS S3, MinIO, R2…). Las credenciales solo existen en el servidor. */
export class S3Storage implements ObjectStorage {
  readonly driver = "s3" as const;
  private readonly client: S3Client;
  constructor(private readonly cfg: S3Config) {
    this.client = new S3Client({
      region: cfg.region,
      ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}),
      forcePathStyle: cfg.forcePathStyle,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    });
  }
  async put(key: string, body: Readable, meta: { contentType: string; size?: number }): Promise<void> {
    assertSafeKey(key);
    // Sin tamaño conocido se bufferiza (solo se usa para archivos pequeños);
    // los binarios grandes pasan por putFile con tamaño conocido.
    let payload: Readable | Buffer = body;
    if (meta.size === undefined) {
      const chunks: Buffer[] = [];
      for await (const c of body) chunks.push(Buffer.from(c as Uint8Array));
      payload = Buffer.concat(chunks);
    }
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        Body: payload,
        ContentType: meta.contentType,
        ...(meta.size !== undefined ? { ContentLength: meta.size } : {}),
      }),
    );
  }
  async putFile(key: string, filePath: string, meta: { contentType: string }): Promise<void> {
    const { size } = await fsStat(filePath);
    await this.put(key, createReadStream(filePath), { contentType: meta.contentType, size });
  }
  async stat(key: string): Promise<number | null> {
    assertSafeKey(key);
    try {
      const r = await this.client.send(new HeadObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
      return r.ContentLength ?? null;
    } catch {
      return null;
    }
  }
  async read(key: string, range?: ByteRange): Promise<Readable> {
    assertSafeKey(key);
    const r = await this.client.send(
      new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key, ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}) }),
    );
    if (!r.Body) throw new Error(`Objeto vacío: ${key}`);
    return r.Body as Readable;
  }
  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
  }
  async healthCheck(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.cfg.bucket }));
  }
}
