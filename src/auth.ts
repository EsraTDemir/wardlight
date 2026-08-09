const encoder = new TextEncoder();

export async function sha256Hex(bytes: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return toHex(new Uint8Array(digest));
}

export async function verifyHmacSignature(
  body: ArrayBuffer,
  secret: string,
  suppliedSignature: string,
): Promise<boolean> {
  if (!/^[a-f0-9]{64}$/i.test(suppliedSignature)) {
    return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, body),
  );
  const supplied = fromHex(suppliedSignature);

  let difference = signature.length ^ supplied.length;
  for (let index = 0; index < signature.length; index += 1) {
    difference |= signature[index] ^ (supplied[index] ?? 0);
  }
  return difference === 0;
}

function fromHex(value: string): Uint8Array {
  const output = new Uint8Array(value.length / 2);
  for (let index = 0; index < output.length; index += 1) {
    output[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return output;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
