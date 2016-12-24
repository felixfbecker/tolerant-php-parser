/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import {
	IPCMessageReader, IPCMessageWriter,
	createConnection, IConnection, TextDocumentSyncKind,
	TextDocuments, TextDocument, Diagnostic, DiagnosticSeverity,
	InitializeParams, InitializeResult, TextDocumentPositionParams,
	CompletionItem, CompletionItemKind
} from 'vscode-languageserver';

// Create a connection for the server. The connection uses Node's IPC as a transport
let connection: IConnection = createConnection(new IPCMessageReader(process), new IPCMessageWriter(process));

// Create a simple text document manager. The text document manager
// supports full document sync only
let documents: TextDocuments = new TextDocuments();
// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// After the server has started the client sends an initilize request. The server receives
// in the passed params the rootPath of the workspace plus the client capabilites. 
let workspaceRoot: string;
connection.onInitialize((params): InitializeResult => {
	workspaceRoot = params.rootPath;
	return {
		capabilities: {
			// Tell the client that the server works in FULL text document sync mode
			textDocumentSync: documents.syncKind
		}
	}
});

documents.onDidOpen((change) => {
	validateTextDocument(change.document);
});

documents.onDidSave((change) => {
	validateTextDocument(change.document);
});

// The settings interface describe the server relevant settings part
interface Settings {
	languageServerExample: ExampleSettings;
}

// These are the example settings we defined in the client's package.json
// file
interface ExampleSettings {
	maxNumberOfProblems: number;
}

// hold the maxNumberOfProblems setting
let maxNumberOfProblems: number;
// The settings have changed. Is send on server activation
// as well.
connection.onDidChangeConfiguration((change) => {
	let settings = <Settings>change.settings;
	maxNumberOfProblems = settings.languageServerExample.maxNumberOfProblems || 100;
	// Revalidate any open text documents
	documents.all().forEach(validateTextDocument);
});

function validateTextDocument(textDocument: TextDocument): void {
	var execSync = require('child_process').execSync;
	var querystring = require('querystring');
	var path = require('path');
	var fileToRead = path.normalize(querystring.unescape(textDocument.uri)).substr(6);
	if (fileToRead.startsWith("x")) {
		return;
	}
	var cmd = `php ${__dirname}/../../server/src/parse.php ${fileToRead}`;
	var out = execSync(cmd).toString();
	var outErrors = JSON.parse(out);
	let diagnostics: Diagnostic[] = [];
	let lines = textDocument.getText().split(/\n/g);

	let allErrors = outErrors["invalid"].concat(outErrors["skipped"]).concat(outErrors["missing"]);

	for (var i = 0; i < allErrors.length && i < maxNumberOfProblems; i++) {
		let error = allErrors[i];
		var errorPos = error["start"];

		var text = textDocument.getText();
		var indexes = [], j = -1;
		while ((j = text.indexOf("\n", j+1)) != -1) {
			if (j < errorPos && j != -1) {
				indexes.push(j);
				continue;
			}
			break;
		}

		var char = errorPos - (indexes.length > 0 ? indexes[indexes.length - 1] : 0) - 1;
		var curLine = indexes.length;
		var endChar = char + (error["length"] - (error["start"] - error["fullStart"]));		
		
		let message = '';
		switch (error["error"]) {
			case "SkippedToken":
				message = `Unexpected ${error["kind"]}`
				break;
			case "MissingToken":
				message = `Expected ${error["kind"]}`
				break;
		}

		message += ` at (line: ${curLine}, character: ${char})`
		diagnostics.push({
			severity: DiagnosticSeverity.Error,
			range: {
				start: { line: curLine, character: char},
				end: { line: curLine, character: endChar}
			},
			message: message,
			source: 'ex'
		});
	}
	// Send the computed diagnostics to VSCode.
	connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

connection.onDidChangeWatchedFiles((change) => {
	// Monitored files have change in VSCode
	connection.console.log('We recevied an file change event');
});


// Listen on the connection
connection.listen();