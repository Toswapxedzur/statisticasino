// Client-side media upload: ask the server for a signed OSS PUT URL, upload the
// bytes directly to OSS, then confirm. Returns the media id to reference.
export async function uploadMedia(file, kind) {
  const sign = await fetch("/api/media/sign", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind, mime: file.type, bytes: file.size }),
  });
  if (!sign.ok) throw new Error(await sign.text().catch(() => "") || "Upload unavailable");
  const { mediaId, uploadUrl } = await sign.json();

  const put = await fetch(uploadUrl, { method: "PUT", headers: { "content-type": file.type }, body: file });
  if (!put.ok) throw new Error("Upload failed");

  await fetch("/api/media/confirm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mediaId }),
  }).catch(() => {});
  return mediaId;
}

export const mediaUrl = (id) => (id ? `/media/${id}` : null);
