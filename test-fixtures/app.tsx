import { Shelf, formatTitle, type Book } from './catalog';
const book: Book = { title: 'A neutral sample' };
const shelf = new Shelf();
shelf.add(book);
formatTitle(book);
export function BookCard() { return <div>{book.title}</div>; }
export const BookBadge = () => <span>Ready</span>;
const panel = <><BookCard /><BookBadge /></>;
