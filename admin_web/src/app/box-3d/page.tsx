import type { Metadata } from "next";

import { Box3dPage } from "@/components/box-designer/box-3d-page";

// The 3D box on its own, full viewport, for the mobile app's web view
// (docs/PACKAGE_BOX_SIZES_PAY_NOW.md section 4). Not a page to find in a search.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function Box3d() {
  return <Box3dPage />;
}
