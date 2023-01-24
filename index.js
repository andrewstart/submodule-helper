const util = require('util');
const fs = require('fs');
const rimraf = util.promisify(require('rimraf'));
const readFile = util.promisify(fs.readFile);
const _exec = util.promisify(require('child_process').exec);
const path = require('path');
const { Command } = require('commander');

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

async function readBranches(configPath)
{
	const branches = new Map();
	try
	{
		const lines = (await readFile(configPath, 'utf8')).split(/[\r\n]+/);
		for (const line of lines)
		{
			const [module, branch] = line.split(' ');
			branches.set(module, branch);
		}
	}
	catch (e)
	{
		// optional file is probably not present, just eat the error
	}
	return branches;
}

function cleanModuleName(module)
{
	if (module && module.endsWith('/'))
		return module.substring(0, module.length - 1);
	return module;
}

async function main()
{
	const modules = await readModules('.gitmodules');
	const branches = await readBranches('.modulebranches');

	const program = new Command();
	program
		.command('clean [targetModule]')
		.description('Removes all changes in all submodules, or a single submodule.')
		.action(async (targetModule) => {
			targetModule = cleanModuleName(targetModule);
			for (const module of modules)
			{
				if (targetModule && targetModule !== module) continue;

				await exec(`git clean -xfdf`, path.resolve(process.cwd(), module));
				await exec(`git submodule deinit -f ${module}`);
				await rimraf(`.git/modules/${module}`);
				await exec(`git rm -f ${module} && git reset .gitmodules ${module}`);
				await exec(`git checkout -- .gitmodules ${module}`);
			}
		});
	program
		.command('checkout [targetModule]')
		.description('Checks out submodule(s) to current commit, and installs dependencies via pnpm.')
		.action(async (targetModule) => {
			targetModule = cleanModuleName(targetModule);
			for (const module of modules)
			{
				if (targetModule && targetModule !== module) continue;

				await exec(`git submodule update --init ${module}`);
				if (branches.has(module))
				{
					await exec(`git checkout ${branches.get(module)}`, path.resolve(process.cwd(), module));
				}
				await exec(`pnpm i -P`, path.resolve(process.cwd(), module));
			}
		});
	program
		.command('pull [targetModule]')
		.description('Pulls latest commit in submodule(s).')
		.action(async (targetModule) => {
			targetModule = cleanModuleName(targetModule);
			for (const module of modules)
			{
				if (targetModule && targetModule !== module) continue;

				await exec(`git submodule sync ${module} && git submodule update --remote ${module}`);
				await exec(`pnpm i -P`, path.resolve(process.cwd(), module));
			}
		});
	program
		.command('remove [targetModule]')
		.description('Removes submodule(s) from repository.')
		.action(async (targetModule) => {
			targetModule = cleanModuleName(targetModule);
			for (const module of modules)
			{
				if (targetModule && targetModule !== module) continue;

				await exec(`git submodule deinit -f ${module}`);
				await rimraf(`.git/modules/${module}`);
				await exec(`git rm -f ${module} && git reset .gitmodules ${module}`);
			}
		});
	program
		.command('list')
		.description('Lists all submodules in the repository.')
		.action(async () => {
			console.log(modules.join('\n'));
		});
	program
		.command('sync <moduleDependency> [targetModule]')
		.description('Updates submodule(s) version of the shared dependency (also a submodule) to current commit.')
		.action(async (moduleDependency, targetModule) => {
			if (!moduleDependency) return;
			moduleDependency = cleanModuleName(moduleDependency);
			targetModule = cleanModuleName(targetModule);
			let hash = await exec('git rev-parse HEAD', path.resolve(process.cwd(), moduleDependency), true);
			hash = hash.trim();
			for (const module of modules)
			{
				if (moduleDependency === module) continue;
				if (targetModule && targetModule !== module) continue;

				const nestedModules = await readModules(path.join(module, '.gitmodules'));
				for (const nest of nestedModules)
				{
					if (nest === moduleDependency)
					{
						console.log(`Ensuring that ${module} is up to date...`);
						const modulePath = path.resolve(process.cwd(), module);
						let mode = await exec(`git ls-files --stage ${moduleDependency}`, modulePath, true);
						mode = mode.substring(0, mode.indexOf(' '));
						await exec(`git update-index --add --cacheinfo ${mode},${hash},${moduleDependency}`, modulePath);
						break;
					}
				}
			}
		});
	return program.parseAsync();
}

main();