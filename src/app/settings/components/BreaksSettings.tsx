
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
  id: z.string().optional(), // ID from react-hook-form's useFieldArray, not the break's actual data ID from context initially
  name: z.string().optional(),
  startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Invalid start time (HH:MM)"),
  endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Invalid end time (HH:MM)"),
  days: z.array(z.enum(ALL_DAYS)).min(1, "Select at least one day."),
}).refine(data => data.startTime < data.endTime, { 
  message: "End time must be after start time.",
  path: ["endTime"],
});

const breaksSchema = z.object({
  scheduled_breaks: z.array(scheduledBreakSchema),
});

type BreaksFormValues = z.infer<typeof breaksSchema>;

export function BreaksSettings() {
  const { settings, replaceAllScheduledBreaks, isLoading } = useSettings();
  const { toast } = useToast();

  const form = useForm<BreaksFormValues>({
    resolver: zodResolver(breaksSchema),
    // Default values are critical. `id` here is for useFieldArray.
    // The actual data from settings.scheduledBreaks doesn't need to map its `id` to the form's `id` field.
    defaultValues: {
      scheduled_breaks: settings.scheduledBreaks.map(sb => ({
        ...sb, // spread all properties from the stored break
        id: sb.id, // explicitly use the stored break's id for react-hook-form's field `id` initially if desired, or let useFieldArray manage its own
      })),
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "scheduled_breaks",
    keyName: "fieldId", // use "fieldId" as the key name for useFieldArray, to avoid conflict with our data "id"
  });

  useEffect(() => {
    if (!isLoading) {
      // Reset form with values from context, ensuring `id` field for useFieldArray is handled correctly
      // `settings.scheduledBreaks` items have `id`, `name`, `startTime`, etc.
      // The form schema also has `id`. We map settings to the form shape.
      form.reset({ 
        scheduled_breaks: settings.scheduledBreaks.map(sb => ({
          id: sb.id, // This is the data ID, which RHF might also use for its own key if not careful
          name: sb.name,
          startTime: sb.startTime,
          endTime: sb.endTime,
          days: sb.days,
        })) 
      });
    }
  }, [settings.scheduledBreaks, isLoading, form]);

  const onSubmit = (data: BreaksFormValues) => {
    // `data.scheduled_breaks` contains the current form state, including user edits.
    // Each item in `data.scheduled_breaks` is of type `scheduledBreakSchema`.
    // We only need to pass the data relevant for creating new ScheduledBreak objects.
    const newBreaksToSave = data.scheduled_breaks.map(sb_form_item => ({
      name: sb_form_item.name,
      startTime: sb_form_item.startTime,
      endTime: sb_form_item.endTime,
      days: sb_form_item.days,
      // The `id` from sb_form_item is react-hook-form's field id, not needed for saving data
    }));

    replaceAllScheduledBreaks(newBreaksToSave);
    
    toast({
      title: "Settings Saved",
      description: "Scheduled breaks have been updated.",
    });
    // No explicit form.reset() here; useEffect will sync the form once settings propagate.
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
            {fields.map((item, index) => ( // item.fieldId is the key for mapping
              <div key={item.fieldId} className="p-4 border rounded-md space-y-4 relative">
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
                 {form.formState.errors.scheduled_breaks?.[index]?.root?.message && (
                  <p className="text-sm font-medium text-destructive">
                    {form.formState.errors.scheduled_breaks[index]?.root?.message}
                  </p>
                )}
                 {form.formState.errors.scheduled_breaks?.[index]?.endTime?.message && (
                  <p className="text-sm font-medium text-destructive">
                    End Time: {form.formState.errors.scheduled_breaks[index]?.endTime?.message}
                  </p>
                )}
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
