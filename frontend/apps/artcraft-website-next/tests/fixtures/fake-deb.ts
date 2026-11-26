import { gzipSync } from "node:zlib";
import { buildTar } from "../../src/lib/linux-repos";

function arMember(name: string, content: Buffer): Buffer {
  const header = Buffer.alloc(60, " ");
  header.write(name, 0, "latin1");
  header.write("0", 16, "latin1");
  header.write("0", 28, "latin1");
  header.write("0", 34, "latin1");
  header.write("100644", 40, "latin1");
  header.write(String(content.length), 48, "latin1");
  header.write("`\n", 58, "latin1");
  const pad = content.length % 2 ? Buffer.from("\n") : Buffer.alloc(0);
  return Buffer.concat([header, content, pad]);
}

/**
 * Builds a minimal .deb (ar archive) with the given control file. `extraControlFiles` adds more
 * files to control.tar, e.g. a large md5sums to push the control member past a Range probe.
 */
export function buildFakeDeb(
  control: string,
  options: { compression?: "gz" | "none"; extraControlFiles?: Record<string, string>; dataBytes?: number } = {},
): Buffer {
  const compression = options.compression ?? "gz";
  const tar = buildTar([
    { name: "./", type: "dir" },
    { name: "./control", type: "file", content: control },
    ...Object.entries(options.extraControlFiles ?? {}).map(([name, content]) => ({
      name: `./${name}`,
      type: "file" as const,
      content,
    })),
  ]);
  const controlMember = compression === "gz"
    ? arMember("control.tar.gz/", gzipSync(tar))
    : arMember("control.tar/", tar);
  return Buffer.concat([
    Buffer.from("!<arch>\n", "latin1"),
    arMember("debian-binary/", Buffer.from("2.0\n")),
    controlMember,
    arMember("data.tar.gz/", Buffer.alloc(options.dataBytes ?? 1024)),
  ]);
}

/** Answers a fetch for a package the way GitHub does: honours `Range: bytes=0-N`. */
export function serveDeb(deb: Buffer, init?: RequestInit): Response {
  const range = new Headers(init?.headers).get("range")?.match(/^bytes=0-(\d+)$/);
  if (init?.method === "HEAD") {
    return new Response(null, { status: 200, headers: { "content-length": String(deb.length) } });
  }
  if (!range) {
    return new Response(new Uint8Array(deb), { status: 200 });
  }
  const end = Math.min(Number(range[1]), deb.length - 1);
  return new Response(new Uint8Array(deb.subarray(0, end + 1)), {
    status: 206,
    headers: { "content-range": `bytes 0-${end}/${deb.length}` },
  });
}
