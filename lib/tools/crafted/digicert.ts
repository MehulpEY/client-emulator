import type { ToolDef, MockContext, MockResult } from "../types";
import { rng, int, pick, chance, daysAgoIso, nowIso, uuid, fakeSha1, fakeMd5, type RNG } from "../helpers";
import { dbAvailable } from "../../db";
import { listResources, getResource, patchResource, putResource, ensureSeeded } from "../../engine/store";

// DigiCert CertCentral - Services API v2 (base https://www.digicert.com/services/v2).
// Static account API key passed in the `X-DC-DEVKEY` header. Responses reproduce
// the real Services API envelopes (`{ orders, page }`, `{ domains, page }`,
// `{ organizations, page }`) and field names. Lookups are seeded from the request
// input so the same order / domain / organization id returns a stable object.
// Certificate orders are STATEFUL (persisted resource store): submitting an order
// persists it, list/get return it, and revoke flips its status to "revoked" - so a
// generator, a manual emit, or an agent's mutating call all show up on re-read.

const CA_CERT = { id: "3F6C1F5A6229C4E9E48B9F", name: "DigiCert Global CA G2" };
const PRODUCT = { name_id: "ssl_plus", name: "Standard SSL", type: "ssl_certificate", validation_type: "ov" };
const COMMON_NAMES = ["example.com", "api.acme.io", "vpn.corp.net", "mail.contoso.com", "shop.example.org"] as const;
const DOMAIN_NAMES = ["example.com", "acme.io", "corp.net", "contoso.com", "example.org"] as const;
const DCV_METHODS = ["email", "dns-cname-token", "dns-txt-token", "http-token", "http-token-dynamic"] as const;
const ORDER_STATUSES = ["issued", "issued", "issued", "pending", "needs_approval"] as const;
const ORGS: readonly [string, string, string, string][] = [
  ["Acme Corporation", "San Francisco", "California", "US"],
  ["Contoso Ltd", "Seattle", "Washington", "US"],
  ["Example LLC", "Austin", "Texas", "US"],
  ["Corp Networks Inc", "Denver", "Colorado", "US"],
  ["Globex Corporation", "New York", "New York", "US"],
];
const REQ_FIRST = ["Sarah", "Michael", "Jennifer", "David", "Emily", "James", "Laura", "Robert"] as const;
const REQ_LAST = ["Johnson", "Williams", "Chen", "Patel", "Garcia", "Nguyen", "Smith", "Brown"] as const;
const STREETS = ["Main St", "Market St", "Technology Way", "Innovation Dr", "Commerce Blvd"] as const;

/** DigiCert renders timestamps as `2024-01-15T10:20:30+00:00` (no milliseconds). */
const dcTime = (iso: string): string => iso.replace(/\.\d{3}Z$/, "+00:00");
/** Date-only `YYYY-MM-DD` (used for certificate validity + DCV expiry). */
const dcDate = (iso: string): string => iso.slice(0, 10);

/** Lowercase alphanumeric token (DCV random values, DNS/HTTP tokens). */
function token(seed: string, len = 32): string {
  const r = rng("digicert:token:" + seed);
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < len; i++) s += chars[Math.floor(r() * chars.length)];
  return s;
}

/** A PEM-encoded certificate block with realistic-looking base64 body. */
function pem(seed: string): string {
  const r = rng("digicert:pem:" + seed);
  const b64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const lines: string[] = [];
  for (let i = 0; i < 16; i++) {
    let line = "";
    for (let j = 0; j < 64; j++) line += b64[Math.floor(r() * b64.length)];
    lines.push(line);
  }
  return "-----BEGIN CERTIFICATE-----\n" + lines.join("\n") + "\n-----END CERTIFICATE-----";
}

/** A CertCentral certificate order with the Services API v2 field set. */
function makeOrder(seed: string) {
  const r = rng("digicert:order:" + seed);
  const id = int(r, 100000, 999999);
  const certId = int(r, 1000000, 9999999);
  const cn: string = pick(r, COMMON_NAMES);
  const dns_names: string[] = chance(r, 0.5) ? [cn, "www." + cn] : [cn];
  const issuedDaysAgo = int(r, 1, 330);
  const [orgName, city, state, country] = pick(r, ORGS);
  return {
    id,
    certificate: {
      id: certId,
      common_name: cn,
      dns_names,
      serial_number: fakeMd5("digicert:serial:" + seed).toUpperCase(),
      thumbprint: fakeSha1("digicert:thumb:" + seed).toUpperCase(),
      signature_hash: "sha256",
      key_size: 2048,
      valid_from: dcDate(daysAgoIso(issuedDaysAgo)),
      valid_till: dcDate(daysAgoIso(issuedDaysAgo - 365)),
      days_remaining: 365 - issuedDaysAgo,
      ca_cert: { id: CA_CERT.id, name: CA_CERT.name },
    },
    status: pick(r, ORDER_STATUSES) as string,
    validity_years: 1,
    date_created: dcTime(daysAgoIso(issuedDaysAgo)),
    organization: { id: int(r, 100000, 999999), name: orgName, city, state, country },
    product: { ...PRODUCT },
    price: int(r, 200, 600),
    currency: "USD",
    payment_method: "balance",
    auto_renew: 0,
    auto_reissue: 0,
  };
}

/** A validated domain with DCV state, per GET /domain. */
function makeDomain(seed: string) {
  const r = rng("digicert:domain:" + seed);
  const name = pick(r, DOMAIN_NAMES);
  const [orgName] = pick(r, ORGS);
  const ovUntil = dcDate(daysAgoIso(-int(r, 30, 700)));
  const evUntil = dcDate(daysAgoIso(-int(r, 30, 400)));
  return {
    id: int(r, 100000, 999999),
    is_active: true,
    name,
    date_created: dcTime(daysAgoIso(int(r, 200, 1200))),
    organization: { id: int(r, 100000, 999999), name: orgName, is_active: "1" },
    validations: [
      { type: "ov", name: "OV", validated_until: ovUntil, status: "active" },
      { type: "ev", name: "EV", validated_until: evUntil, status: "active" },
    ],
    dcv_method: "email",
    dcv_expiration: { ov: ovUntil, ev: evUntil, ov_status: "valid", ev_status: "valid" },
    container: { id: int(r, 1, 99), name: orgName },
    base_domain: name,
  };
}

/** An organization / division, per GET /organization. */
function makeOrg(seed: string) {
  const r = rng("digicert:org:" + seed);
  const [name, city] = pick(r, ORGS);
  return {
    id: int(r, 100000, 999999),
    status: "active",
    name,
    display_name: name,
    is_active: true,
    address: `${int(r, 100, 9999)} ${pick(r, STREETS)}`,
    city,
    state: "Utah",
    country: "us",
    telephone: `+1 801 555 0${int(r, 100, 999)}`,
    container: { id: int(r, 1, 99), parent_id: 0, name: `${name} Container`, is_active: true },
    validations: [],
    ev_approvers: [],
  };
}

/** A DigiCert revocation request (POST order/cert revoke responses). */
function revokeRequest(r: RNG, comments?: string) {
  const first = pick(r, REQ_FIRST);
  const last = pick(r, REQ_LAST);
  return {
    id: int(r, 1, 999),
    date: dcTime(nowIso()),
    type: "revoke",
    status: "pending",
    requester: {
      id: int(r, 1000, 9999),
      first_name: first,
      last_name: last,
      email: `${first.toLowerCase()}.${last.toLowerCase()}@digicert-account.com`,
    },
    comments: comments || "Revocation requested by account administrator.",
  };
}

export const digicert: ToolDef = {
  id: "digicert",
  name: "DigiCert CertCentral",
  vendor: "DigiCert",
  category: "pki",
  crafted: true,
  aiTool: true,
  summary:
    "DigiCert CertCentral certificate lifecycle management via the Services API v2 - submit, list, retrieve, reissue, download, and revoke TLS/SSL certificate orders, plus domain (DCV) and organization validation management.",
  tags: ["pki", "certificates", "tls", "ssl", "certcentral", "certificate-lifecycle"],
  auth: { type: "api_key_header", param: "X-DC-DEVKEY" },
  docsUrl: "https://dev.digicert.com/certcentral-apis/services-api.html",
  defaultLatencyMs: 350,
  endpoints: [
    {
      method: "POST",
      path: "/order/certificate/{product_name_id}",
      operation: "submitOrder",
      summary: "Submit a new certificate order for a product (e.g. ssl_plus). Persists the order.",
      aiTool: true,
      // Persist happens directly (putResource) below; emit a non-persist activity
      // event so the thin submit response doesn't overwrite the stored order via
      // the persist-mapped `order.created` (which is reserved for generators).
      emits: "order.submitted",
      request: {
        certificate: {
          common_name: "example.com",
          dns_names: ["example.com", "www.example.com"],
          csr: "-----BEGIN CERTIFICATE REQUEST-----\n...\n-----END CERTIFICATE REQUEST-----",
          signature_hash: "sha256",
        },
        organization: { id: 123456 },
        validity_years: 1,
        payment_method: "balance",
        skip_approval: true,
      },
      params: [
        { name: "X-DC-DEVKEY", in: "header", type: "string", required: true, description: "CertCentral account API key." },
        { name: "product_name_id", in: "path", type: "string", required: true, description: "Product to order the certificate for.", enum: ["ssl_plus", "ssl_ev", "ssl_basic", "ssl_securesite", "ssl_wildcard", "ssl_multi_domain", "private_ssl_plus"], default: "ssl_plus", example: "ssl_plus" },
        { name: "certificate.common_name", in: "body", type: "string", required: true, description: "Primary domain (subject CN) for the certificate.", format: "domain name", example: "example.com" },
        { name: "certificate.dns_names[]", in: "body", type: "array", description: "Additional SAN domains included on the certificate.", format: "domain name", example: "www.example.com" },
        { name: "certificate.csr", in: "body", type: "string", required: true, description: "PEM-encoded certificate signing request.", format: "PEM CSR" },
        { name: "certificate.signature_hash", in: "body", type: "string", description: "Signature hash algorithm.", enum: ["sha256", "sha384", "sha512"], default: "sha256" },
        { name: "organization.id", in: "body", type: "integer", required: true, description: "Validated organization (division) id that owns the order.", example: 123456 },
        { name: "validity_years", in: "body", type: "integer", description: "Certificate validity period in years.", enum: ["1", "2"], default: 1, example: 1 },
        { name: "payment_method", in: "body", type: "string", description: "How the order is paid for.", enum: ["balance", "profile", "card"], default: "balance" },
        { name: "skip_approval", in: "body", type: "boolean", description: "Auto-approve and issue immediately; otherwise the order stays pending.", example: true },
      ],
      respond: async (ctx: MockContext): Promise<MockResult> => {
        const productId = ctx.params.product_name_id || "ssl_plus";
        const seed = "submit:" + productId + ":" + uuid();
        const order = makeOrder(seed);
        const skip = ctx.body?.skip_approval === true || ctx.body?.skip_approval === "true";
        order.status = skip ? "issued" : "pending";
        if (ctx.body?.certificate?.common_name) order.certificate.common_name = ctx.body.certificate.common_name;
        if (Array.isArray(ctx.body?.certificate?.dns_names)) order.certificate.dns_names = ctx.body.certificate.dns_names;
        await putResource("digicert", "orders", String(order.id), order);
        const r = rng("digicert:submitresp:" + seed);
        return {
          status: 201,
          body: {
            id: order.id,
            certificate_id: order.certificate.id,
            dcv_random_value: token("dcv:" + seed, 32),
            requests: [{ id: int(r, 1000000, 9999999), status: "pending" }],
            certificate_chain: [
              { subject_common_name: order.certificate.common_name, pem: pem("leaf:" + seed) },
              { subject_common_name: "DigiCert Global CA G2", pem: pem("ca:" + seed) },
              { subject_common_name: "DigiCert Global Root G2", pem: pem("root:" + seed) },
            ],
          },
        };
      },
    },
    {
      method: "GET",
      path: "/order/certificate",
      operation: "listOrders",
      summary: "List certificate orders (supports filters[status]). Stateful - returns persisted orders.",
      aiTool: true,
      request: { "filters[status]": "issued" },
      params: [
        { name: "X-DC-DEVKEY", in: "header", type: "string", required: true, description: "CertCentral account API key." },
        { name: "filters[status]", in: "query", type: "string", description: "Return only orders in this status.", enum: ["issued", "pending", "needs_approval", "revoked"], example: "issued" },
        { name: "limit", in: "query", type: "integer", description: "Maximum number of orders to return.", default: 1000, example: 100 },
        { name: "offset", in: "query", type: "integer", description: "Zero-based offset for pagination.", default: 0, example: 0 },
      ],
      respond: async (ctx: MockContext): Promise<MockResult> => {
        const statusFilter = ctx.query["filters[status]"] || null;
        if (!dbAvailable()) {
          let orders = Array.from({ length: 5 }, (_, i) => makeOrder("list:" + i));
          if (statusFilter) orders = orders.filter((o) => o.status === statusFilter);
          return {
            status: 200,
            body: {
              orders,
              page: { total: orders.length, limit: 1000, offset: 0 },
              note: "database offline - synthetic, not persisted",
            },
          };
        }
        await ensureSeeded("digicert", "orders", 5, () => {
          const d = makeOrder("seed:" + uuid());
          return { id: String(d.id), data: d };
        });
        const { items, total } = await listResources("digicert", "orders", { limit: 1000, status: statusFilter });
        return { status: 200, body: { orders: items.map((x) => x.data), page: { total, limit: 1000, offset: 0 } } };
      },
    },
    {
      method: "GET",
      path: "/order/certificate/{order_id}",
      operation: "getOrder",
      summary: "Retrieve a single certificate order by id (full order detail).",
      aiTool: true,
      request: { order_id: "123456" },
      params: [
        { name: "X-DC-DEVKEY", in: "header", type: "string", required: true, description: "CertCentral account API key." },
        { name: "order_id", in: "path", type: "integer", required: true, description: "Certificate order id.", example: 123456 },
      ],
      respond: async (ctx: MockContext): Promise<MockResult> => {
        const id = ctx.params.order_id;
        if (!dbAvailable()) {
          const o = makeOrder("get:" + id);
          o.id = Number(id) || o.id;
          return { status: 200, body: o };
        }
        const res = await getResource("digicert", "orders", id);
        if (!res) return { status: 404, body: { error: `order ${id} not found` } };
        return { status: 200, body: res.data };
      },
    },
    {
      method: "POST",
      path: "/order/certificate/{order_id}/reissue",
      operation: "reissueOrder",
      summary: "Reissue the certificate for an existing order (new key / CSR).",
      emits: "order.reissued",
      request: {
        certificate: {
          common_name: "example.com",
          csr: "-----BEGIN CERTIFICATE REQUEST-----\n...\n-----END CERTIFICATE REQUEST-----",
        },
        skip_approval: true,
      },
      params: [
        { name: "X-DC-DEVKEY", in: "header", type: "string", required: true, description: "CertCentral account API key." },
        { name: "order_id", in: "path", type: "integer", required: true, description: "Order whose certificate is being reissued.", example: 123456 },
        { name: "certificate.common_name", in: "body", type: "string", description: "Primary domain (subject CN) for the reissued certificate.", format: "domain name", example: "example.com" },
        { name: "certificate.csr", in: "body", type: "string", required: true, description: "PEM-encoded certificate signing request for the new key.", format: "PEM CSR" },
        { name: "skip_approval", in: "body", type: "boolean", description: "Auto-approve and issue the reissue immediately.", example: true },
      ],
      respond: (ctx: MockContext): MockResult => {
        const r = rng("digicert:reissue:" + ctx.params.order_id);
        return { status: 201, body: { id: Number(ctx.params.order_id) || 0, requests: [{ id: int(r, 1000000, 9999999) }] } };
      },
    },
    {
      method: "PUT",
      path: "/order/certificate/{order_id}/revoke",
      operation: "revokeOrder",
      summary: "Revoke the certificate of an order. Stateful - flips the order status to revoked.",
      emits: "order.revoked",
      request: { comments: "Key compromise suspected." },
      params: [
        { name: "X-DC-DEVKEY", in: "header", type: "string", required: true, description: "CertCentral account API key." },
        { name: "order_id", in: "path", type: "integer", required: true, description: "Order whose certificate is being revoked.", example: 123456 },
        { name: "comments", in: "body", type: "string", description: "Reason for the revocation request.", format: "free text", example: "Key compromise suspected." },
      ],
      respond: async (ctx: MockContext): Promise<MockResult> => {
        await patchResource("digicert", "orders", ctx.params.order_id, { status: "revoked" });
        const r = rng("digicert:revoke:" + ctx.params.order_id);
        return { status: 201, body: revokeRequest(r, ctx.body?.comments) };
      },
    },
    {
      method: "PUT",
      path: "/certificate/{certificate_id}/revoke",
      operation: "revokeCertificate",
      summary: "Revoke a specific issued certificate by certificate id.",
      emits: "certificate.revoked",
      request: { comments: "Certificate no longer in use." },
      params: [
        { name: "X-DC-DEVKEY", in: "header", type: "string", required: true, description: "CertCentral account API key." },
        { name: "certificate_id", in: "path", type: "integer", required: true, description: "Certificate id to revoke.", example: 1234567 },
        { name: "comments", in: "body", type: "string", description: "Reason for the revocation request.", format: "free text", example: "Certificate no longer in use." },
      ],
      respond: (ctx: MockContext): MockResult => {
        const r = rng("digicert:revokecert:" + ctx.params.certificate_id);
        return { status: 201, body: revokeRequest(r, ctx.body?.comments) };
      },
    },
    {
      method: "GET",
      path: "/certificate/download/order/{order_id}/format/{format_type}",
      operation: "downloadCertificate",
      summary: "Download the issued certificate for an order (pem_all, pem_noroot, p7b, default).",
      request: { order_id: "123456", format_type: "pem_all" },
      params: [
        { name: "X-DC-DEVKEY", in: "header", type: "string", required: true, description: "CertCentral account API key." },
        { name: "order_id", in: "path", type: "integer", required: true, description: "Order whose issued certificate is downloaded.", example: 123456 },
        { name: "format_type", in: "path", type: "string", required: true, description: "Certificate bundle format.", enum: ["pem_all", "pem_noroot", "p7b", "default"], default: "default", example: "pem_all" },
      ],
      respond: (ctx: MockContext): MockResult => {
        const id = ctx.params.order_id;
        const leaf = pem("leaf:" + id);
        const ca = pem("ca:" + id);
        const root = pem("root:" + id);
        const body = ctx.params.format_type === "pem_noroot" ? `${leaf}\n${ca}` : `${leaf}\n${ca}\n${root}`;
        return { status: 200, body, headers: { "content-type": "application/x-pem-file" } };
      },
    },
    {
      method: "GET",
      path: "/domain",
      operation: "listDomains",
      summary: "List domains registered in the account, with validation (DCV) state.",
      aiTool: true,
      params: [
        { name: "X-DC-DEVKEY", in: "header", type: "string", required: true, description: "CertCentral account API key." },
        { name: "limit", in: "query", type: "integer", description: "Maximum number of domains to return.", default: 1000, example: 100 },
        { name: "offset", in: "query", type: "integer", description: "Zero-based offset for pagination.", default: 0, example: 0 },
      ],
      respond: (): MockResult => {
        const domains = Array.from({ length: 5 }, (_, i) => makeDomain("list:" + i));
        return { status: 200, body: { domains, page: { total: domains.length, limit: 1000, offset: 0 } } };
      },
    },
    {
      method: "GET",
      path: "/domain/{domain_id}/validation",
      operation: "getDomainValidation",
      summary: "Get the validation state and DCV token details for a domain.",
      request: { domain_id: "123456" },
      params: [
        { name: "X-DC-DEVKEY", in: "header", type: "string", required: true, description: "CertCentral account API key." },
        { name: "domain_id", in: "path", type: "integer", required: true, description: "Domain id to fetch DCV validation state for.", example: 123456 },
      ],
      respond: (ctx: MockContext): MockResult => {
        const d = makeDomain("val:" + ctx.params.domain_id);
        return {
          status: 200,
          body: {
            validations: d.validations,
            dcv_token: {
              token: token("dcv:" + ctx.params.domain_id, 40),
              status: "pending",
              expiration_date: dcTime(daysAgoIso(-7)),
              dns_txt_value: "digicert-domain-verification=" + token("txt:" + ctx.params.domain_id, 32),
              dns_cname_value: token("cname:" + ctx.params.domain_id, 32) + ".dcv.digicert.com",
              http_token_url: `http://${d.name}/.well-known/pki-validation/fileauth.txt`,
            },
          },
        };
      },
    },
    {
      method: "GET",
      path: "/domain/dcv/method",
      operation: "listDcvMethods",
      summary: "List the supported domain control validation (DCV) methods.",
      params: [
        { name: "X-DC-DEVKEY", in: "header", type: "string", required: true, description: "CertCentral account API key." },
      ],
      respond: (): MockResult => ({ status: 200, body: { dcv_methods: [...DCV_METHODS] } }),
    },
    {
      method: "GET",
      path: "/organization",
      operation: "listOrganizations",
      summary: "List organizations (divisions) in the account.",
      aiTool: true,
      params: [
        { name: "X-DC-DEVKEY", in: "header", type: "string", required: true, description: "CertCentral account API key." },
        { name: "limit", in: "query", type: "integer", description: "Maximum number of organizations to return.", default: 1000, example: 100 },
        { name: "offset", in: "query", type: "integer", description: "Zero-based offset for pagination.", default: 0, example: 0 },
      ],
      respond: (): MockResult => {
        const organizations = Array.from({ length: 3 }, (_, i) => makeOrg("list:" + i));
        return { status: 200, body: { organizations, page: { total: organizations.length, limit: 1000, offset: 0 } } };
      },
    },
    {
      method: "GET",
      path: "/organization/{organization_id}",
      operation: "getOrganization",
      summary: "Retrieve a single organization by id.",
      request: { organization_id: "123456" },
      params: [
        { name: "X-DC-DEVKEY", in: "header", type: "string", required: true, description: "CertCentral account API key." },
        { name: "organization_id", in: "path", type: "integer", required: true, description: "Organization (division) id.", example: 123456 },
      ],
      respond: (ctx: MockContext): MockResult => {
        const o = makeOrg("get:" + ctx.params.organization_id);
        o.id = Number(ctx.params.organization_id) || o.id;
        return { status: 200, body: o };
      },
    },
  ],
  events: [
    {
      type: "order.created",
      summary: "A certificate order was submitted.",
      persist: { collection: "orders", idOf: (d) => String(d.id) },
      sample: () => makeOrder("evt:" + uuid()),
    },
    {
      type: "order.revoked",
      summary: "A certificate order was revoked.",
      sample: () => ({ ...makeOrder("evt:" + uuid()), status: "revoked" }),
    },
  ],
};
