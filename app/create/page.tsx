import BookCreator from "./BookCreator";

export const metadata = {
  title: "Create a book | Interactive Story Book",
  description: "Create an image book and get a shareable link.",
};

export default function CreateBookPage() {
  return <BookCreator />;
}
