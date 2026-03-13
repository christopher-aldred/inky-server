/**
 * Represents a processed calendar event with normalized data
 */
export interface ProcessedEvent {
	date: string;
	time: string;
	title: string;
	isAllDay: boolean;
}
