"use client";
import { sortBy } from "lodash";

export default function NewPage() {
  const test = sortBy([1, 2, 3], (n: any) => n);

	return (
		<html lang="en">
			<body>
				<div>hello world</div>
	      <div>{JSON.stringify(test)}</div>
			</body>
		</html>
	);
}