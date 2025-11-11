/**
 * Parkrun Event Name Diagnostic
 *
 * Paste this into the console on a parkrun consolidated club page
 * to diagnose why certain events might not be getting parsed
 */

(function() {
    console.clear();
    console.log('🔍 Parkrun Event Name Diagnostic');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const clubName = 'Woodstock Runners';

    // Find all H2 headers
    const eventHeaders = document.querySelectorAll('h2');
    console.log(`Found ${eventHeaders.length} H2 headers\n`);

    let eventNum = 0;

    for (const h2 of eventHeaders) {
        eventNum++;

        // Get raw text content
        const rawText = h2.textContent;
        const trimmedText = rawText.trim();

        console.log(`━━━ Event ${eventNum} ━━━`);
        console.log(`Raw text: "${rawText}"`);
        console.log(`Trimmed: "${trimmedText}"`);
        console.log(`Length: ${trimmedText.length}`);

        // Show character codes to detect hidden characters
        console.log(`Char codes: [${Array.from(trimmedText).map(c => c.charCodeAt(0)).join(', ')}]`);

        // Apply the transformation logic
        let eventName = trimmedText;

        // Check if should skip
        const shouldSkip = !eventName ||
                          eventName.toLowerCase().includes('consolidated') ||
                          eventName.toLowerCase().includes('report');

        console.log(`Should skip: ${shouldSkip}`);

        if (!shouldSkip) {
            // Apply transformations
            const afterFirstReplace = eventName.replace(/\s+parkrun,/i, ',');
            const afterSecondReplace = afterFirstReplace.replace(/\s+parkrun$/i, '');
            eventName = afterSecondReplace.trim();

            console.log(`After "parkrun," replacement: "${afterFirstReplace}"`);
            console.log(`After "parkrun$" replacement: "${afterSecondReplace}"`);
            console.log(`Final name: "${eventName}"`);

            // Find the next table
            let currentElement = h2.nextElementSibling;
            let resultsTable = null;
            let stepsToTable = 0;

            while (currentElement) {
                stepsToTable++;
                if (currentElement.tagName === 'TABLE') {
                    resultsTable = currentElement;
                    break;
                }
                if (currentElement.tagName === 'H2') {
                    break;
                }
                currentElement = currentElement.nextElementSibling;
            }

            console.log(`Table found: ${resultsTable ? 'YES' : 'NO'} (after ${stepsToTable} steps)`);

            if (resultsTable) {
                // Count rows
                const tbody = resultsTable.querySelector('tbody') || resultsTable;
                const rows = Array.from(tbody.querySelectorAll('tr')).slice(1); // Skip header
                console.log(`Total rows: ${rows.length}`);

                // Count club member rows
                let clubRows = 0;
                let exampleClubMember = null;

                for (const row of rows) {
                    const cells = Array.from(row.querySelectorAll('td'));
                    if (cells.length >= 5) {
                        const club = cells[3]?.textContent.trim() || '';
                        if (club.includes(clubName)) {
                            clubRows++;
                            if (!exampleClubMember) {
                                const runnerName = cells[2]?.textContent.trim() || '';
                                const time = cells[4]?.textContent.trim() || '';
                                exampleClubMember = { runnerName, club, time };
                            }
                        }
                    }
                }

                console.log(`${clubName} members: ${clubRows}`);
                if (exampleClubMember) {
                    console.log(`Example: ${exampleClubMember.runnerName} - ${exampleClubMember.time} (${exampleClubMember.club})`);
                }
            }
        }

        console.log('');
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ Diagnostic complete');

})();
