const util = require('util');
const fs = require('fs');
const rimraf = util.promisify(require('rimraf'));
const readFile = util.promisify(fs.readFile);
const _exec = util.promisify(require('child_process').exec);
const path = require('path');

async function exec(command, cwd)
{
	try
	{
		const { stdout, stderr } = await _exec(command, {cwd: cwd || process.cwd()});
		if (stdout) console.log(stdout);
		if (stderr) console.error(stderr);
	}
	catch (e)
	{
		console.error(e.stderr || e);
	}
}

async function main()
{
	const args = process.argv.slice(2);
	let modules = [];
	try
	{
		for (const match of (await readFile('.gitmodules', 'utf8')).matchAll(/\[submodule "([^"]+)"\]/g))
		{
			modules.push(match[1]);
		}
	}
	catch (e)
	{
		console.error('Could not read .gitmodules:', e.message);
	}
	let targetModule = args[1];
	if (targetModule && targetModule.endsWith('/'))
	{
		targetModule = targetModule.substring(0, targetModule.length - 1);
	}
	switch (args[0])
	{
		case 'clean':
			for (const module of modules)
			{
				if (targetModule && targetModule !== module) continue;

				await exec(`git clean -xfdf`, path.resolve(process.cwd(), module));
				await exec(`git submodule deinit -f ${module}`);
				await rimraf(`.git/modules/${module}`);
				await exec(`git rm -f ${module} && git reset .gitmodules ${module}`);
				await exec(`git checkout -- .gitmodules ${module}`);
			}
			break;
		case 'checkout':
			for (const module of modules)
			{
				if (targetModule && targetModule !== module) continue;

				await exec(`git submodule update --init ${module}`);
				await exec(`pnpm i -P`, path.resolve(process.cwd(), module));
			}
			break;
		case 'pull':
			for (const module of modules)
			{
				if (targetModule && targetModule !== module) continue;

				await exec(`git submodule sync ${module} && git submodule update --remote ${module}`);
				await exec(`pnpm i -P`, path.resolve(process.cwd(), module));
			}
			break;
		case 'remove':
			for (const module of modules)
			{
				if (targetModule && targetModule !== module) continue;

				await exec(`git submodule deinit -f ${module}`);
				await rimraf(`.git/modules/${module}`);
				await exec(`git rm -f ${module} && git reset .gitmodules ${module}`);
			}
			break;
		case 'list':
			console.log(modules.join('\n'));
			break;
	}
}

main();