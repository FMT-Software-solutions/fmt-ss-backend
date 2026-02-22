export function parseEmailList(emailString: string | undefined): string[] {
    if (!emailString) {
        return [];
    }
    return emailString.split(',').map((email) => email.trim()).filter((email) => email.length > 0);
}
