/**
 * domain_probe — lightweight domain-level signals without LLM.
 * Checks HTTP reachability, redirect chain, and SSL certificate.
 * All I/O is network-only; safe to retry.
 */
import * as dns from "node:dns";
import * as http from "node:http";
import * as https from "node:https";
import { URL } from "node:url";
import { log } from "@temporalio/activity";

export interface DomainProbeArgs {
  url: string;
  /** Follow up to N redirects. Default 5. */
  max_redirects?: number;
  /** Connection timeout ms. Default 10000. */
  timeout?: number;
  _idempotency_key?: string;
}

export interface DomainProbeResult {
  domain: string;
  domain_active: boolean;
  site_status: "active" | "inactive" | "unknown";
  /** HTTP status code of the final response after following redirects. */
  http_status?: number;
  /** Chain of redirect URLs. Empty if no redirects. */
  redirect_chain: string[];
  /** Final resolved URL. */
  final_url?: string;
  /** True if site redirected to a different root domain. */
  domain_redirected: boolean;
  /** SSL certificate expiry date (ISO-8601). Null if HTTP or unavailable. */
  ssl_expiry_date?: string;
  /** Days until SSL expiry. Negative = already expired. */
  ssl_expiry_days?: number;
  dns_resolves: boolean;
  error?: string;
}

function rootDomain(url: string): string {
  try {
    const { hostname } = new URL(url);
    const parts = hostname.replace(/^www\./, "").split(".");
    return parts.slice(-2).join(".");
  } catch {
    return url;
  }
}

function fetchHead(
  url: string,
  timeout: number
): Promise<{ status: number; location?: string; server?: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: parsed.pathname + parsed.search,
        method: "HEAD",
        timeout,
      },
      (res) => {
        resolve({
          status: res.statusCode ?? 0,
          location: res.headers.location,
          server: res.headers.server as string | undefined,
        });
        res.resume();
      }
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.on("error", reject);
    req.end();
  });
}

function sslExpiry(hostname: string, timeout: number): Promise<{ expiry: Date } | null> {
  return new Promise((resolve) => {
    const req = https.request(
      { hostname, port: 443, path: "/", method: "HEAD", timeout },
      (res) => {
        const cert = (
          res.socket as { getPeerCertificate?: () => { valid_to?: string } }
        ).getPeerCertificate?.();
        if (cert?.valid_to) resolve({ expiry: new Date(cert.valid_to) });
        else resolve(null);
        res.resume();
      }
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
    req.end();
  });
}

function dnsLookup(hostname: string): Promise<boolean> {
  return new Promise((resolve) => {
    dns.lookup(hostname, (err) => resolve(!err));
  });
}

export async function domain_probe(args: DomainProbeArgs): Promise<DomainProbeResult> {
  const timeout = args.timeout ?? 10_000;
  const maxRedirects = args.max_redirects ?? 5;

  let parsed: URL;
  try {
    parsed = new URL(args.url.startsWith("http") ? args.url : `https://${args.url}`);
  } catch (e) {
    return {
      domain: args.url,
      domain_active: false,
      site_status: "unknown",
      redirect_chain: [],
      domain_redirected: false,
      dns_resolves: false,
      error: String(e),
    };
  }

  const domain = parsed.hostname;
  log.info("domain_probe", { domain });

  const dns_resolves = await dnsLookup(domain);
  if (!dns_resolves) {
    return {
      domain,
      domain_active: false,
      site_status: "inactive",
      redirect_chain: [],
      domain_redirected: false,
      dns_resolves: false,
    };
  }

  const redirect_chain: string[] = [];
  let currentUrl = parsed.href;
  let finalStatus = 0;
  let error: string | undefined;

  for (let i = 0; i < maxRedirects + 1; i++) {
    try {
      const resp = await fetchHead(currentUrl, timeout);
      finalStatus = resp.status;
      if (resp.status >= 300 && resp.status < 400 && resp.location) {
        redirect_chain.push(currentUrl);
        currentUrl = new URL(resp.location, currentUrl).href;
      } else {
        break;
      }
    } catch (e) {
      error = String(e);
      break;
    }
  }

  const originDomain = rootDomain(parsed.href);
  const finalDomain = rootDomain(currentUrl);
  const domain_redirected = originDomain !== finalDomain && redirect_chain.length > 0;

  const domain_active = dns_resolves && !error && finalStatus > 0 && finalStatus < 500;
  const site_status: DomainProbeResult["site_status"] =
    finalStatus === 0 ? "unknown" : finalStatus < 400 ? "active" : "inactive";

  // SSL check (best effort)
  let ssl_expiry_date: string | undefined;
  let ssl_expiry_days: number | undefined;
  if (parsed.protocol === "https:") {
    const ssl = await sslExpiry(domain, timeout);
    if (ssl) {
      ssl_expiry_date = ssl.expiry.toISOString();
      ssl_expiry_days = Math.floor((ssl.expiry.getTime() - Date.now()) / 86_400_000);
    }
  }

  return {
    domain,
    domain_active,
    site_status,
    http_status: finalStatus || undefined,
    redirect_chain,
    final_url: currentUrl !== parsed.href ? currentUrl : undefined,
    domain_redirected,
    ssl_expiry_date,
    ssl_expiry_days,
    dns_resolves,
    error,
  };
}
