export interface Book { title: string }
export class Shelf {
    add(book: Book) { return book.title; }
}
export const formatTitle = (book: Book) => book.title;
export function unusedTitle() { return 'Unused'; }
