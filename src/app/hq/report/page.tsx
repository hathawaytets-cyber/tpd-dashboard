import { Page, PageHeader } from "@/components/shell/page";
import { ComplaintForm } from "@/components/ia/complaint-form";

export const metadata = { title: "Report misconduct" };

/** Members file through the same intake as the public. Signed-in members get the roster picker; the server verifies it. */
export default function HqReportPage() {
  return (
    <Page>
      <PageHeader eyebrow="Internal Affairs" title="Report misconduct" description="File a complaint or a supervisor referral with Internal Affairs. Your report goes only to IA; it is not shared with your chain of command." />
      <ComplaintForm inHq />
    </Page>
  );
}
