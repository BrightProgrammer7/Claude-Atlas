import type { Metadata } from "next";
import quizQuestions from "@/data/quiz.json";
import type { QuizQuestion } from "@/lib/atlas-types";
import QuizQr from "../QuizQr";
import QuizClient from "./QuizClient";

export const metadata: Metadata = {
  title: "Claude Atlas quiz",
  description: "Ten questions, before and after. Anonymous scores per event.",
};

export default function QuizPage() {
  return (
    <QuizClient
      questions={quizQuestions as QuizQuestion[]}
      qrCode={<QuizQr className="block size-36 rounded-md border border-hair" />}
    />
  );
}
