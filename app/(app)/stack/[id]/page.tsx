"use client";

import { useParams } from "next/navigation";
import { SuiteFrame } from "@/components/suite/suite-frame";

export default function StackAppPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params.id === "string" ? params.id : "";
  return <SuiteFrame id={id} />;
}
