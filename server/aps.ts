import { APS_BASE, APS_BUCKET_KEY, APS_CLIENT_ID, APS_CLIENT_SECRET } from "./config.ts";

export interface ApsToken {
  access_token: string;
  expires_in: number;
}

export interface ModelListing {
  name: string;
  urn: string;
}

export async function getToken(scope: string): Promise<ApsToken> {
  const res = await fetch(`${APS_BASE}/authentication/v2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${APS_CLIENT_ID}:${APS_CLIENT_SECRET}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials", scope }),
  });
  if (!res.ok) {
    throw new Error(`APS token request failed (${res.status}): ${await res.text()}`);
  }
  return (await res.json()) as ApsToken;
}

export async function listModels(): Promise<ModelListing[]> {
  const { access_token } = await getToken("data:read");
  const res = await fetch(`${APS_BASE}/oss/v2/buckets/${encodeURIComponent(APS_BUCKET_KEY)}/objects?limit=100`, {
    headers: {
      Authorization: `Bearer ${access_token}`
    }
  });
  if (!res.ok) {
    throw new Error(`OSS listing failed (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as { items?: Array<{ objectKey: string; objectId: string; }> };
  return (json.items ?? [])
    .filter((item) => item.objectKey.toLowerCase().endsWith(".rvt"))
    .map((item) => ({
      name: item.objectKey,
      // The URN is just the object id in base64url — no Model Derivative call needed.
      urn: new TextEncoder().encode(item.objectId).toBase64({ alphabet: "base64url", omitPadding: true }),
    }));
}
