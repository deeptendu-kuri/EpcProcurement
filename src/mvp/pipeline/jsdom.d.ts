// Minimal typing for the parts of jsdom the pipeline reader uses (the project has no @types/jsdom).
declare module "jsdom" {
  export class JSDOM {
    constructor(html?: string, options?: { url?: string; contentType?: string });
    readonly window: { document: Document; close(): void };
  }
}
