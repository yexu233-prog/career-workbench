import { Fragment } from "react";
import { parseBoldText } from "@career-workbench/domain";

export function BoldText({ value }: { value: string }) {
  return <>{parseBoldText(value).map((segment, index) => <Fragment key={index}>{segment.bold ? <strong>{segment.text}</strong> : segment.text}</Fragment>)}</>;
}
