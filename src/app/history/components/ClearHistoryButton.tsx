"use client";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useWorkHistory } from "@/contexts/WorkHistoryContext";
import { useToast } from "@/hooks/use-toast";
import { Trash2 } from "lucide-react";

export function ClearHistoryButton() {
  const { clearHistory, workHistory } = useWorkHistory();
  const { toast } = useToast();

  const handleClearHistory = () => {
    clearHistory();
    toast({
      title: "History Cleared",
      description: "All work history has been deleted.",
    });
  };

  if (workHistory.length === 0) {
    return null;
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm">
          <Trash2 className="mr-2 h-4 w-4" /> Clear All History
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
          <AlertDialogDescription>
            This action will permanently delete all your work history. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleClearHistory}
            className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
          >
            Yes, delete all
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
