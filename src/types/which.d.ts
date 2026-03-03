declare module 'which' {
  interface Options {
    path?: string;
    pathExt?: string;
    all?: boolean;
    nothrow?: boolean;
  }
  function which(cmd: string, opts?: Options): Promise<string>;
  namespace which {
    function sync(cmd: string, opts?: Options): string;
  }
  export = which;
}
