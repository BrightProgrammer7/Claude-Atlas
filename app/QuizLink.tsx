import Link from "next/link";
import QuizQr from "./QuizQr";

export default function QuizLink() {
  return (
    <Link
      href="/quiz"
      className="flex items-center gap-2 rounded-md border border-hair px-2.5 py-1 text-sm text-ink transition-colors hover:border-accent hover:text-accent"
    >
      <span>Quiz</span>
      <QuizQr className="hidden size-9 rounded-sm sm:block" />
    </Link>
  );
}
