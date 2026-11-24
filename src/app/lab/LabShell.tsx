"use client";
import dynamic from "next/dynamic";

const Lab = dynamic(() => import("@/client/lab/Lab"), { ssr: false });
export default function LabShell() {
  return <Lab />;
}
