// occt-import-js ships no types: an emscripten factory resolving to the module (typed in occt.ts).
declare module "occt-import-js" {
  interface FactoryOptions {
    locateFile?: (path: string, scriptDirectory: string) => string;
  }
  const factory: (options?: FactoryOptions) => Promise<unknown>;
  export default factory;
}
