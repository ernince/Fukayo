import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { env } from 'process';
import sanitize from 'sanitize-filename';
export class FileServer {
  static #instance: FileServer;
  folder: string;
  /** default file's lifetime in seconds */
  #defaultLifeTime = 60*60*24;
  #timeouts: {filename: string, timeout: NodeJS.Timeout}[];
  /**
   *
   * @param folder folder to serve files from (relative to %appdata%/.cache)
   */
  constructor(folder:string) {
    if(!env.USER_DATA) throw new Error('USER_DATA not set');
    this.folder = resolve(env.USER_DATA, '.cache', folder);
    this.#timeouts = [];
    this.setup();
    this.empty();
  }

  protected logger(...args: unknown[]) {
    const prefix = env.VERBOSE === 'true' ? `${new Date().toLocaleString()} [api] (${this.constructor.name})` : `[api] (\x1b[34m${this.constructor.name}\x1b[0m)`;
    if(env.MODE === 'development' || env.VERBOSE === 'true') console.log(prefix ,...args);
  }

  static getInstance(folder:string) {
    if (this.#instance) {
        return this.#instance;
    }
    if(!folder) throw new Error('couldn\'t create instance, no folder given');
    this.#instance = new FileServer(folder);
    return this.#instance;
  }

  setup() {
    if(!existsSync(this.folder)) mkdirSync(this.folder, { recursive: true });
    return this.folder;
  }

  empty() {
    if(!existsSync(this.folder)) throw new Error(`${this.folder} does not exist`);
    // empty the file-serving directory
    const files = readdirSync(this.folder);
    for(const file of files) {
      const path2file = join(this.folder, file);
      if(existsSync(path2file)) {
        const stat = statSync(path2file);
        if(!stat.isSymbolicLink()) {
          try {
            unlinkSync(path2file);
          } catch {
            // ignore
          }
        }
      }
    }
    this.logger(files.length, 'files removed');
  }

  #resolveFile(filename: string) {
    return resolve(this.folder, sanitize(filename));
  }

  #resetFile(filename: string, lifetime: number) {
    const path = this.#resolveFile(filename);
    const fileExist = existsSync(path);
    const hasTimeout = this.#timeouts.find(({filename: f}) => f === filename);

    if(fileExist) {
      if(hasTimeout) {
        clearTimeout(hasTimeout.timeout);
        hasTimeout.timeout = setTimeout(() => {
          this.delete(filename);
        }, lifetime * 1000);
        return true;
      }
      this.#timeouts.push({filename, timeout: setTimeout(() => {
        this.delete(filename);
      }, lifetime * 1000)});
      return true;
    }

    if(hasTimeout) { // && !fileExist
      clearTimeout(hasTimeout.timeout);
      this.#timeouts = this.#timeouts.filter(({filename: f}) => f !== filename);
    }
    return false;
  }

  #initFile(filename: string, buffer:Buffer, lifetime = this.#defaultLifeTime) {
    try {
      writeFileSync(this.#resolveFile(filename), buffer);
      this.#timeouts.push({filename, timeout: setTimeout(() => {
        this.delete(filename);
      }, lifetime * 1000)});
      return true;
    } catch {
      return false;
    }
  }

  /**
   *
   * @param data the data to serv
   * @param filename its filename
   * @param lifetime how lang is the file available (in seconds)
   */
  serv (data: Buffer, filename:string, lifetime = this.#defaultLifeTime) {
    const exist = this.#resetFile(filename, lifetime);
    if(exist) return `/files/${filename}`;

    const create = this.#initFile(filename, data, lifetime);
    if(create) return `/files/${filename}`;

    return `/files/${filename}`;
  }

  /** delete file */
  delete (filename: string) {
    try {
      const find = this.#timeouts.find(({filename: f}) => f === filename);
      if(find) clearTimeout(find.timeout);
      this.#timeouts = this.#timeouts.filter(({filename: f}) => f !== filename);
      this.logger('file\'s lifetime reached, removing:', filename);
      unlinkSync(this.#resolveFile(filename));
      return true;
    } catch(e) {
      return false;
    }
  }

  /** renew lifetime */
  renew(filename:string, lifetime = this.#defaultLifeTime) {
    return this.#resetFile(filename, lifetime);
  }

  /** get file */
  get(filename:string) {
    // in case filename is "https://localhost:8080/files/filename"
    filename = filename.replace(/(.*files\/)?/g, '');
    const file = this.#resolveFile(filename);
    if(existsSync(file)) {
      return readFileSync(file);
    }
  }
}
