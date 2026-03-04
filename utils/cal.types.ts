import { IcalEvent, IcalOccurrence, ICalDateTime } from "ical-expander";

export type CalendarItem = IcalEvent | IcalOccurrence;

export const toDate = (value: ICalDateTime | Date): Date =>
  value instanceof Date ? value : value.toJSDate();

export const isOccurrence = (event: CalendarItem): event is IcalOccurrence =>
  (event as IcalOccurrence).item !== undefined;

export interface CalendarData {
  [date: string]: {
    [time: string]: string[];
  };
}

export interface CalendarSource {
  url: string;
}
