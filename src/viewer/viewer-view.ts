import { renderBookBodyHtml, viewToggleHtml, type BookData, type BookLabels } from '../results/html-book';

/** 책 본문과 뷰 전환 컨트롤을 주입하고 탭 제목을 책 제목으로 바꾼다. 뷰어의 순수 렌더 단계(이벤트 연결은 별도). */
export function renderViewer(root: HTMLElement, book: BookData, labels: BookLabels): void {
  root.innerHTML = renderBookBodyHtml(book, labels) + viewToggleHtml(book, labels);
  if (book.title) document.title = book.title;
}
