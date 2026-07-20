import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto'

// DER-префикс PKCS8 для x25519 — позволяет собрать KeyObject из 32 сырых байт
const PKCS8_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex')

export interface RealityKeypair {
  privateKey: string
  publicKey: string
}

// Формат совпадает с выводом `xray x25519`: base64url без padding
export function generateRealityKeypair(): RealityKeypair {
  const { publicKey, privateKey } = generateKeyPairSync('x25519')
  const priv = (privateKey.export({ type: 'pkcs8', format: 'der' }) as Buffer).subarray(-32)
  const pub = (publicKey.export({ type: 'spki', format: 'der' }) as Buffer).subarray(-32)
  return { privateKey: priv.toString('base64url'), publicKey: pub.toString('base64url') }
}

export function derivePublicKey(privateKeyB64: string): string {
  const raw = Buffer.from(privateKeyB64, 'base64url')
  if (raw.length !== 32) {
    throw Object.assign(new Error('Приватный ключ должен быть 32 байта в base64url'), {
      statusCode: 400,
    })
  }
  const key = createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, raw]),
    format: 'der',
    type: 'pkcs8',
  })
  return (createPublicKey(key).export({ type: 'spki', format: 'der' }) as Buffer)
    .subarray(-32)
    .toString('base64url')
}
