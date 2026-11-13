import { Suspense } from "react";
import { IaCase } from "@/components/ia/ia-case";

export const metadata = { title: "Internal Affairs case" };

/** Query-string route (?id=) because the static export cannot pre-render one page per case. */
export default function InternalAffairsCasePage() {
  return (
    <Suspense>
      <IaCase />
    </Suspense>
  );
}
