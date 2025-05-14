"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useFieldArray, Controller } from "react-hook-form";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useSettings } from "@/contexts/SettingsContext";
import { useToast } from "@/hooks/use-toast";
import type { DayOfWeek, ScheduledBreak } from "@/types";
import { ALL_DAYS } from "@/types";
import { Trash2, PlusCircle } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useEffect } from "react";

const scheduledBreakSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Invalid start time (HH:MM)"),
  endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Invalid end time (HH:MM)"),
  days: z.array(z.enum(ALL_DAYS)).min(1, "Select at least one day."),
}).refine(data => data.startTime < data.endTime, { // Basic check, doesn't handle midnight crossing.
  message: "End time must be after start time.",
  path: ["endTime"],
});

const breaksSchema = z.object({
  scheduled_breaks: z.array(scheduledBreakSchema),
});

type BreaksFormValues = z.infer<typeof breaksSchema>;

export function BreaksSettings() {
  const { settings, addScheduledBreak, updateScheduledBreak, removeScheduledBreak, isLoading } = useSettings();
  const { toast } = useToast();

  const form = useForm<BreaksFormValues>({
    resolver: zodResolver(breaksSchema),
    defaultValues: {
      scheduled_breaks: settings.scheduledBreaks,
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "scheduled_breaks",
  });

  useEffect(() => {
    if (!isLoading) {
      form.reset({ scheduled_breaks: settings.scheduledBreaks });
    }
  }, [settings.scheduledBreaks, isLoading, form]);

  const onSubmit = (data: BreaksFormValues) => {
    // Similar to hourly allowances, for simplicity, replace all.
    // A more robust solution would diff and call add/update/remove context functions.
    settings.scheduledBreaks.forEach(sb => removeScheduledBreak(sb.id));
    data.scheduled_breaks.forEach(sb => {
      const newBreak: Omit<ScheduledBreak, 'id'> = {
        name: sb.name,
        startTime: sb.startTime,
        endTime: sb.endTime,
        days: sb.days,
      };
      addScheduledBreak(newBreak);
    });
    
    toast({
      title: "Settings Saved",
      description: "Scheduled breaks have been updated.",
    });
    form.reset({ scheduled_breaks: data.scheduled_breaks.map(sb => ({...sb, id: sb.id || Date.now().toString() })) });
  };

  if (isLoading) return <p>Loading breaks settings...</p>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Scheduled Breaks</CardTitle>
        <CardDescription>Set specific times when breaks automatically occur. These are typically unpaid and will be deducted from work time.</CardDescription>
      </CardHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <CardContent className="space-y-6">
            {fields.map((item, index) => (
              <div key={item.id} className="p-4 border rounded-md space-y-4 relative">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => remove(index)}
                  className="absolute top-2 right-2 text-destructive hover:text-destructive-foreground hover:bg-destructive"
                >
                  <Trash2 className="h-5 w-5" />
                  <span className="sr-only">Remove Break</span>
                </Button>
                
                <FormField
                  control={form.control}
                  name={`scheduled_breaks.${index}.name`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Break Name (Optional)</FormLabel>
                      <Input type="text" placeholder="e.g., Lunch Break" {...field} />
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name={`scheduled_breaks.${index}.startTime`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Start Time</FormLabel>
                        <Input type="time" {...field} />
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`scheduled_breaks.${index}.endTime`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>End Time</FormLabel>
                        <Input type="time" {...field} />
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name={`scheduled_breaks.${index}.days`}
                  render={() => (
                    <FormItem>
                      <FormLabel>Days</FormLabel>
                      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-7 gap-2">
                        {ALL_DAYS.map((day) => (
                          <FormField
                            key={day}
                            control={form.control}
                            name={`scheduled_breaks.${index}.days`}
                            render={({ field }) => {
                              return (
                                <FormItem className="flex flex-row items-start space-x-2 space-y-0">
                                  <FormControl>
                                    <Checkbox
                                      checked={field.value?.includes(day)}
                                      onCheckedChange={(checked) => {
                                        return checked
                                          ? field.onChange([...(field.value || []), day])
                                          : field.onChange(
                                              (field.value || []).filter(
                                                (value) => value !== day
                                              )
                                            );
                                      }}
                                    />
                                  </FormControl>
                                  <FormLabel className="text-sm font-normal whitespace-nowrap">
                                    {day.substring(0,3)}
                                  </FormLabel>
                                </FormItem>
                              );
                            }}
                          />
                        ))}
                      </div>
                      <FormMessage />
                       <FormDescription className="text-xs">
                        If no days are selected, the break will not apply.
                      </FormDescription>
                    </FormItem>
                  )}
                />
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => append({ name: "", startTime: "12:00", endTime: "12:30", days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] })}
              className="mt-2"
            >
              <PlusCircle className="mr-2 h-4 w-4" /> Add Scheduled Break
            </Button>
          </CardContent>
          <CardFooter className="border-t px-6 py-4">
            <Button type="submit" disabled={form.formState.isSubmitting || !form.formState.isDirty}>Save Scheduled Breaks</Button>
            {form.formState.isDirty && (
                <Button type="button" variant="ghost" onClick={() => form.reset()} className="ml-2">
                  Cancel
                </Button>
            )}
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
