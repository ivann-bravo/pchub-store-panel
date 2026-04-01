"use client";

import { toast } from "sonner";
import { useCallback } from "react";

export function useDemoAction(message: string) {
  return useCallback(
    (e?: React.MouseEvent | React.FormEvent) => {
      e?.preventDefault();
      toast.warning(message, { duration: 4000 });
    },
    [message]
  );
}
