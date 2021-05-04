const util = require('util');
const fs = require('fs');
const rimraf = util.promisify(require('rimraf'));
const readFile = util.promisify(fs.readFile);
const _exec = util.promisify(require('child_process').exec);
const path = require('path');

async function exec(command, cwd, returnVal = false)
{
	try
	{
		const { stdout, stderr } = await _exec(command, {cwd: cwd || process.cwd()});
		if (stdout && !returnVal) console.log(stdout);
		if (stderr) console.error(stderr);
		if (returnVal) return (stdout || '');
	}
	catch (e)
	{
		console.error(e.stderr || e);
	}
}

async function readModules(gitModulesPath)
{
	let modules = [];
	try
	{
		for (const match of (await readFile(gitModulesPath, 'utf8')).matchAll(/\[submodule "([^"]+)"\]/g))
		{
			modules.push(match[1]);
		}
	}
	catch (e)
	{
		console.error('Could not read .gitmodules:', e.message);
	}
	return modules;
}

async function main()
{
	const args = process.argv.slice(2);
	const modules = await readModules('.gitmodules');
	let targetModule = args[1];
	if (targetModule && targetModule.endsWith('/'))
	{
		targetModule = targetModule.substring(0, targetModule.length - 1);
	}
	let secondaryTarget = args[2];
	if (secondaryTarget && secondaryTarget.endsWith('/')) {
		secondaryTarget = secondaryTarget.substring(0, secondaryTarget.length - 1);
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
		case 'sync':
			if (!targetModule) return;
			let hash = await exec('git rev-parse HEAD', path.resolve(process.cwd(), targetModule), true);
			hash = hash.trim();
			for (const module of modules)
			{
				if (targetModule === module) continue;
				if (secondaryTarget && secondaryTarget !== module) continue;

				const nestedModules = await readModules(path.join(module, '.gitmodules'));
				for (const nest of nestedModules)
				{
					if (nest === targetModule)
					{
						console.log(`Ensuring that ${module} is up to date...`);
						const modulePath = path.resolve(process.cwd(), module);
						let mode = await exec(`git ls-files --stage ${targetModule}`, modulePath, true);
						mode = mode.substring(0, mode.indexOf(' '));
						await exec(`git update-index --add --cacheinfo ${mode},${hash},${targetModule}`, modulePath);
						break;
					}
				}
			}
			break;
	}
}

main();