// 产权密码学存证：每个造物归属 Ed25519 签名（防篡改、可公开验证），
// 全量归属定期算 Merkle 根公示。将来上链 = 把 currentRoot() 字符串锚定到公链（接口已留）。
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as edSign,
  verify as edVerify,
  type KeyObject,
} from "node:crypto";
import fs from "node:fs";
import path from "node:path";

let privateKey: KeyObject;
let publicKey: KeyObject;

/** 首启生成 Ed25519 密钥对，持久化 data/attest-key.pem（部署不覆盖 data/） */
export function initAttest(dataDir: string) {
  fs.mkdirSync(dataDir, { recursive: true });
  const pemPath = path.join(dataDir, "attest-key.pem");
  const pubPath = path.join(dataDir, "attest-pub.pem");
  if (fs.existsSync(pemPath)) {
    privateKey = createPrivateKey(fs.readFileSync(pemPath, "utf8"));
    publicKey = createPublicKey(fs.readFileSync(pubPath, "utf8"));
  } else {
    const { privateKey: priv, publicKey: pub } = generateKeyPairSync("ed25519");
    privateKey = priv;
    publicKey = pub;
    fs.writeFileSync(pemPath, priv.export({ type: "pkcs8", format: "pem" }).toString(), { mode: 0o600 });
    fs.writeFileSync(pubPath, pub.export({ type: "spki", format: "pem" }).toString());
  }
}

/** 签名内容：造物唯一归属信息（改任何一项验章即失败） */
function proofPayload(objectId: string, creatorId: string, createdAt: number): Buffer {
  return Buffer.from(`w3d-proof:v1:${objectId}:${creatorId}:${createdAt}`, "utf8");
}

/** 给造物归属盖章（~0.05ms） */
export function signObject(objectId: string, creatorId: string, createdAt: number): string {
  return edSign(null, proofPayload(objectId, creatorId, createdAt), privateKey).toString("base64");
}

/** 公开验章：任何人可验证（篡改 false） */
export function verifyObjectProof(
  objectId: string,
  creatorId: string,
  createdAt: number,
  sig: string
): boolean {
  try {
    return edVerify(null, proofPayload(objectId, creatorId, createdAt), publicKey, Buffer.from(sig, "base64"));
  } catch {
    return false;
  }
}

/** 导出公钥（客户端/第三方可拿去自验，等价于「公示验章器」） */
export function attestPublicKeyPem(): string {
  return publicKey.export({ type: "spki", format: "pem" }).toString();
}

// ---------- Merkle 公示根 ----------

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/**
 * 全量归属指纹：所有 (objectId, creatorId) 排序后链式哈希成一个根。
 * 任何一条归属记录被篡改，重算的根都会变——历史公示根即为公证锚点。
 */
export function buildMerkleRoot(entries: Array<{ id: string; creatorId: string }>): { root: string; count: number } {
  const leaves = [...entries]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((e) => sha256(`${e.id}:${e.creatorId}`));
  if (leaves.length === 0) return { root: sha256("w3d-empty"), count: 0 };
  // 链式哈希（足够给存证公示用；树形优化无必要）
  let acc = leaves[0];
  for (let i = 1; i < leaves.length; i++) acc = sha256(acc + leaves[i]);
  return { root: sha256(`w3d-root:${acc}:${leaves.length}`), count: leaves.length };
}
