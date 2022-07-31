import { SchedulerClass } from '../server/helpers/scheduler';
import Mirror from '.';
import icon from './icons/komga.png';
import type MirrorInterface from './interfaces';
import type { MangaPage } from './types/manga';
import type { socketInstance } from '../server/types';

//  /series?search=word
type searchContent = {
  content: {
    id: string,
    metadata: {
      title: string,
      summary: string,
      language: string,
      genres: string[],
      tags: string[],
    },
    booksMetadata: {
      authors: string[],
      tags: string[],
    },
  }[]

}

// /series/{id}/books
type bookContent = {
  content: {
    created: string,
    deleted: boolean,
    id: string,
    media: {
      pagesCount: number,
    },
    metadata: {
      numberSort: number,
      releaseDate: null|string,
      title: string,
    },
  }[]
}
// /books/{id}
type book = {
  id: string,
  seriesId: string
  media: {
    pagesCount: number,
  },
}

class Komga extends Mirror<{login?: string|null, password?:string|null, host?:string|null, port?:number|null, protocol:'http'|'https'}> implements MirrorInterface {
  constructor() {
    super({
      host: 'http://localhost',
      name: 'komga',
      displayName: 'Komga',
      langs: ['en', 'fr'],
      waitTime: 200,
      icon,
      meta: {
        speed: 1,
        quality:1,
        popularity: 1,
      },
      options: {
        enabled: true,
        cache: true,
        login: null,
        password: null,
        host: null,
        port: null,
        protocol: 'http',
      },
    });
  }

  changeSettings(opts: Record<string, unknown>) {
    this.options = { ...this.options, ...opts };
  }

  private path(path:string) {
    if(!this.options.protocol || !this.options.host || !this.options.port) throw new Error('missing credentials');
    return `${this.options.protocol}://${this.options.host}:${this.options.port}/api/v1${path}`;
  }

  isMangaPage(url: string): boolean {
    url = url.replace(/(\?.*)/g, ''); // remove hash/params from the url
    const res = /^(\/series\/\w+)|(\/book\/\w+)$/gmi.test(url);
    if(!res) this.logger('not a manga page:', url);
    return res;
  }
  isChapterPage(url: string): boolean {
    url = url.replace(/(\?.*)/g, ''); // remove hash/params from the url
    const res = /^(\/books\/\w+)|(\/book\/\w+\/read)$/gmi.test(url);
    if(!res) this.logger('not a chapter page:', url);
    return res;
  }

  async search(query:string, socket: socketInstance|SchedulerClass, id:number) {
    try {
      if(!this.options.login || !this.options.password || !this.options.host || !this.options.port) throw 'no credentials';
      if(!this.options.login.length || !this.options.password.length || !this.options.host.length) throw 'no credentials';
      // we will check if user don't need results anymore at different intervals
      let cancel = false;
      if(!(socket instanceof SchedulerClass)) {
        socket.once('stopSearchInMirrors', () => {
          this.logger('search canceled');
          cancel = true;
        });
      }

      const url = this.path(`/series?search=${query}`);
      const res = await this.fetch<searchContent>({url, auth: {username: this.options.login, password: this.options.password}}, 'json');
      for(const result of res.content) {
        if(cancel) break;
        const name = result.metadata.title;
        const link = `/series/${result.id}`;
        const covers = [];
        const img = await this.downloadImage(this.path(`/series/${result.id}/thumbnail`), undefined, false, {auth: { username: this.options.login, password: this.options.password}} ).catch(() => undefined);
        if(img) covers.push(img);

        const synopsis = result.metadata.summary;
        const mangaId = `${this.name}/${result.metadata.language}${`/series/${result.id}`}`;

        const books = await this.fetch<bookContent>({url: this.path(`/series/${result.id}/books?sort=metadata.numberSort%2Cdesc`), auth: {username: this.options.login, password: this.options.password}}, 'json');
        const last_release = { chapter: books.content[0].metadata.numberSort, name: books.content[0].metadata.title };
        let lang = 'xx';
        if(result.metadata.language && result.metadata.language.length) lang = result.metadata.language;
        // we return the results based on SearchResult model
        socket.emit('searchInMirrors', id, {
          id: mangaId,
          mirrorinfo: this.mirrorInfo,
          name,
          url:link,
          covers,
          synopsis,
          last_release,
          lang,
          inLibrary: this.isInLibrary(this.mirrorInfo.name, result.metadata.language, link) ? true : false,
        });
      }
      if(cancel) return this.stopListening(socket);
    } catch(e) {
      this.logger('error while searching mangas', e);
      if(e instanceof Error) socket.emit('searchInMirrors', id, {mirror: this.name, error: 'search_error', trace: e.message});
      else if(typeof e === 'string') socket.emit('searchInMirrors', id, {mirror: this.name, error: 'search_error', trace: e});
      else socket.emit('searchInMirrors', id, {mirror: this.name, error: 'search_error'});
    }
    socket.emit('searchInMirrors', id, { done: true });
    this.stopListening(socket);
  }

  async manga(url:string, lang:string, socket:socketInstance|SchedulerClass, id:number)  {

    // we will check if user don't need results anymore at different intervals
    let cancel = false;
    if(!(socket instanceof SchedulerClass)) {
      socket.once('stopShowManga', () => {
        this.logger('fetching manga canceled');
        cancel = true;
      });
    }
    const isMangaPage = this.isMangaPage(url);
    if(!isMangaPage) return socket.emit('showManga', id, {error: 'manga_error_invalid_link'});


    //
    try {
      if(!this.options.login || !this.options.password || !this.options.host || !this.options.port) throw 'no credentials';
      if(!this.options.login.length || !this.options.password.length || !this.options.host.length) throw 'no credentials';

      const result = await this.fetch<searchContent['content'][0]>({
        url: this.path(`${url}`),
        auth: {username: this.options.login, password: this.options.password},
      }, 'json');
      const name = result.metadata.title;
      const lang = result.metadata.language;

      if(cancel) return this.stopListening(socket);
      const mangaId = `${this.name}/${result.metadata.language}${`/series/${result.id}`}`;
      const covers:string[] = [];
      const img = await this.downloadImage(this.path(`/series/${result.id}/thumbnail`), undefined, false, {auth: { username: this.options.login, password: this.options.password}} ).catch(() => undefined);
      if(img) covers.push(img);

      const synopsis = result.metadata.summary;
      const authors:string[] = result.booksMetadata.authors;
      const tags:string[] = [...result.booksMetadata.tags, ...result.metadata.genres];

      const chapters:MangaPage['chapters'] = [];

      const books = await this.fetch<bookContent>({url: this.path(`/series/${result.id}/books?size=2000&sort=metadata.numberSort%2Cdesc`), auth: {username: this.options.login, password: this.options.password}}, 'json');
      for(const book of books.content) {
        let date:number = Date.now();
        if(book.created && book.created.length) date = new Date(book.created).getTime();
        if(book.metadata.releaseDate && book.metadata.releaseDate.length) date = new Date(book.metadata.releaseDate).getTime();
        if(cancel) break;
        const chaplink = `/books/${book.id}`;
        const release: MangaPage['chapters'][0] = {
          id: `${mangaId}@${chaplink}`,
          name: book.metadata.title,
          number: book.metadata.numberSort,
          url: chaplink,
          date: date,
          read:false,
        };
        chapters.push(release);
      }
      this.stopListening(socket);
      if(cancel) return;
      return socket.emit('showManga', id, {id: mangaId, url, lang, name, synopsis, covers, authors, tags, chapters: chapters.sort((a,b) => b.number - a.number), inLibrary: false, mirror: this.name });
    } catch(e) {
      this.stopListening(socket);
      this.logger('error while fetching manga', '@', url, e);
      // we catch any errors because the client needs to be able to handle them
      if(e instanceof Error) return socket.emit('showManga', id, {error: 'manga_error', trace: e.message});
      if(typeof e === 'string') return socket.emit('showManga', id, {error: 'manga_error', trace: e});
      return socket.emit('showManga', id, {error: 'manga_error_unknown'});
    }
  }

  async chapter(url:string, lang:string, socket:socketInstance|SchedulerClass, id:number, callback?: (nbOfPagesToExpect:number)=>void, retryIndex?:number) {
    // we will check if user don't need results anymore at different intervals
    let cancel = false;
    if(!(socket instanceof SchedulerClass)) {
      socket.once('stopShowChapter', () => {
        this.logger('fetching chapter canceled');
        cancel = true;
      });
    }

    // safeguard, we return an error if the link is not a chapter page
    const isLinkaChapter = this.isChapterPage(url);
    if(!isLinkaChapter) {
      this.stopListening(socket);
      return socket.emit('showChapter', id, {error: 'chapter_error_invalid_link'});
    }

    if(cancel) return this.stopListening(socket);

    try {
      if(!this.options.login || !this.options.password || !this.options.host || !this.options.port) throw 'no credentials';
      if(!this.options.login.length || !this.options.password.length || !this.options.host.length) throw 'no credentials';
      const res = await this.fetch<book>({url: this.path(url), auth: {username: this.options.login, password: this.options.password}}, 'json');
      const nbOfPages = res.media.pagesCount-1;
      if(callback) callback(nbOfPages);
      if(cancel) return this.stopListening(socket);
      // loop for each page

      for(let i = 0; i < res.media.pagesCount; i++) {
        if(cancel) break;
        if(typeof retryIndex === 'number' && i !== retryIndex) continue;
        // URL de la demande: https://demo.komga.org/api/v1/books/64/pages/35
        const img = await this.downloadImage(this.path(`/books/${res.id}/pages/${i+1}`), undefined, false, {auth: { username: this.options.login, password: this.options.password}} ).catch(() => undefined);
        if(img) {
          socket.emit('showChapter', id, { index: i, src: img, lastpage: i+1 === nbOfPages });
        } else {
          socket.emit('showChapter', id, { error: 'chapter_error_fetch', index: i, lastpage: i+1 === nbOfPages });
        }
      }
      this.stopListening(socket);
    } catch(e) {
      this.stopListening(socket);
      this.logger('error while fetching chapter', e);
      // we catch any errors because the client needs to be able to handle them
      if(e instanceof Error) return socket.emit('showChapter', id, {error: 'chapter_error', trace: e.message});
      if(typeof e === 'string') return socket.emit('showChapter', id, {error: 'chapter_error', trace: e});
      return socket.emit('showChapter', id, {error: 'chapter_error_unknown'});
    }
  }

  async recommend(socket: socketInstance|SchedulerClass, id: number) {
    try {
      if(!this.options.login || !this.options.password || !this.options.host || !this.options.port) throw 'no credentials';
      if(!this.options.login.length || !this.options.password.length || !this.options.host.length) throw 'no credentials';
      // we will check if user don't need results anymore at different intervals
      let cancel = false;
      if(!(socket instanceof SchedulerClass)) {
        socket.once('stopShowRecommend', () => {
          this.logger('fetching recommendations canceled');
          cancel = true;
        });
      }
      const url = this.path('/series?size=2000');
      const $ = await this.fetch<searchContent>({
        url,
        auth: {username: this.options.login, password: this.options.password},
      }, 'json');

      for(const serie of $.content) {
        if(cancel) break;

        const link = `/series/${serie.id}`;
        const mangaId = `${this.name}/${serie.metadata.language}${link}`;

        const covers = [];
        const img = await this.downloadImage(this.path(`/series/${serie.id}/thumbnail`), undefined, false, {auth: { username: this.options.login, password: this.options.password}} ).catch(() => undefined);
        if(img) covers.push(img);
        let lang = 'xx';
        if(serie.metadata.language && serie.metadata.language.length) lang = serie.metadata.language;

        socket.emit('showRecommend', id, {
          id: mangaId,
          mirrorinfo: this.mirrorInfo,
          name: serie.metadata.title,
          url:link,
          covers,
          lang,
          inLibrary: this.isInLibrary(this.mirrorInfo.name, serie.metadata.language, link) ? true : false,
        });
      }
      this.stopListening(socket);
      if(cancel) return;
      socket.emit('showRecommend', id, { done: true });
    } catch(e) {
      this.stopListening(socket);
      this.logger('error while recommending mangas', e);
      if(e instanceof Error) socket.emit('showRecommend', id, {mirror: this.name, error: 'recommend_error', trace: e.message});
      else if(typeof e === 'string') socket.emit('showRecommend', id, {mirror: this.name, error: 'recommend_error', trace: e});
      else socket.emit('showRecommend', id, {mirror: this.name, error: 'recommend_error_unknown'});
      socket.emit('showRecommend', id, { done: true });
    }

  }

  async mangaFromChapterURL(socket: socketInstance, id: number, url: string, lang?: string) {
    url = url.replace(/(\?.*)/g, ''); // remove hash/params from the url
    url = url.replace(this.host, ''); // remove the host from the url
    if(this.options.host && this.options.port && this.options.protocol) {
      url = url.replace(this.options.host, '');
      url = url.replace(':'+this.options.port.toString(), '');
      url = url.replace(/http(s?):\/\//, '');
    }
    // if no lang is provided, we will use the default one
    lang = lang||this.langs[0];
    // checking what kind of page this is
    const isMangaPage = this.isMangaPage(url),
          isChapterPage = this.isChapterPage(url);

    if(!isMangaPage && !isChapterPage) return socket.emit('getMangaURLfromChapterURL', id, undefined);
    if(isMangaPage || isChapterPage) {
      try {
        if(!this.options.login || !this.options.password || !this.options.host || !this.options.port) throw 'no credentials';
        if(!this.options.login.length || !this.options.password.length || !this.options.host.length) throw 'no credentials';
        url = url.replace('/read', '');
        url = url.replace(/book(s?)/, 'books');
        const match = url.match(/\/series\/(\w+)/);
        let mangaPageURL = '/series/';
        if(match) {
          mangaPageURL += match[1];
        } else {
          const res = await this.fetch<book>({url: this.path(url), auth: {username: this.options.login, password: this.options.password}}, 'json');
          mangaPageURL += res.seriesId;
        }
        if(mangaPageURL) return socket.emit('getMangaURLfromChapterURL', id, { url: mangaPageURL, lang, mirror: this.name });
        return socket.emit('getMangaURLfromChapterURL', id, undefined);
      } catch(e) {
        if(e instanceof Error) this.logger('error while fetching manga from chapter url', e.message);
        else this.logger('error while fetching manga from chapter url', e);
        return socket.emit('getMangaURLfromChapterURL', id, undefined);
      }
    }
  }
}


const komga = new Komga();
export default komga;
